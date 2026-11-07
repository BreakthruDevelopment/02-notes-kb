import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { DEMO_EMBED_MODEL, embed, liveEmbedModel } from "@/lib/ai";
import { chunkMarkdown, searchText } from "@/lib/chunker";
import { db, schema } from "@/lib/db";
import type { Note } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { refundUsage, reserveUsage } from "@/lib/usage";

const { note, noteChunk } = schema;

/** embed() accepts at most 32 texts per call. */
const EMBED_BATCH = 32;

/**
 * The model embed() will return vectors for under the current configuration: the live model when a provider
 * and key are configured, otherwise the demo model. A chunk is searchable by vector, and a note is `ready`,
 * only when its stored `embedding_model` equals this.
 */
export function expectedEmbedModel(): string {
  const e = env();
  const live = e.AI_PROVIDER !== "demo" && Boolean(e.GEMINI_API_KEY);
  return live ? liveEmbedModel() : DEMO_EMBED_MODEL;
}

export const contentHash = (model: string, title: string, content: string) =>
  createHash("sha256").update(model).update(title).update(content).digest("hex");

export type IndexResult = { status: "ready" | "pending" | "skipped"; embedded: number; capped: boolean };

/**
 * Chunk the note, embed only the chunks whose hash (or embedding) is not current, in as few embed() calls as
 * possible, and write the result. The keyword index (`search_text`) is always written, even when the daily cap
 * is hit or the embedding call fails; then the note stays `pending` and findable by keyword.
 * Throws only on a database error; `reindexNote` swallows that.
 */
export async function indexNote(n: Pick<Note, "id" | "title" | "body" | "updatedAt">): Promise<IndexResult> {
  const model = expectedEmbedModel();
  const wanted = chunkMarkdown(n.body).map((content, ord) => ({
    ord,
    content,
    searchText: searchText(n.title, content),
    hash: contentHash(model, n.title, content),
  }));

  const existing = await db()
    .select({
      ord: noteChunk.ord,
      hash: noteChunk.contentHash,
      hasVector: sql<boolean>`${noteChunk.embedding} is not null`,
      model: noteChunk.embeddingModel,
    })
    .from(noteChunk)
    .where(eq(noteChunk.noteId, n.id));
  const byOrd = new Map(existing.map((c) => [c.ord, c]));

  const stale = wanted.filter((c) => {
    const old = byOrd.get(c.ord);
    return !(old && old.hash === c.hash && old.hasVector && old.model === model);
  });

  // Embed in batches of 32 within the daily cap. Anything not embedded is written without a vector.
  const vectors = new Map<number, { vector: number[]; model: string }>();
  let capped = false;
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH);
    if (!(await reserveUsage("embed", batch.length, env().EMBED_DAILY_CHUNKS))) {
      capped = true;
      log.warn("index.embed_cap_reached", { noteId: n.id, chunks: batch.length });
      break;
    }
    try {
      const res = await embed({ task: "embed-note", texts: batch.map((c) => c.searchText), kind: "document" });
      // The free demo provider costs nothing, so it doesn't use up the live budget.
      if (res.demo) await refundUsage("embed", batch.length);
      batch.forEach((c, k) => vectors.set(c.ord, { vector: res.vectors[k], model: res.model }));
    } catch (err) {
      await refundUsage("embed", batch.length).catch(() => undefined);
      log.warn("index.embed_failed", { noteId: n.id, chunks: batch.length, error: err instanceof Error ? err.message : String(err) });
      break;
    }
  }

  return db().transaction(async (tx) => {
    // Lock the note and make sure it hasn't been edited while we were embedding; if it has, the newer
    // save runs its own reindex and this result would be stale.
    const [current] = await tx
      .select({ updatedAt: note.updatedAt })
      .from(note)
      .where(eq(note.id, n.id))
      .for("update");
    if (!current || current.updatedAt.getTime() !== n.updatedAt.getTime()) {
      return { status: "skipped" as const, embedded: 0, capped };
    }

    await tx.delete(noteChunk).where(and(eq(noteChunk.noteId, n.id), sql`${noteChunk.ord} >= ${wanted.length}`));
    for (const c of stale) {
      const v = vectors.get(c.ord);
      const values = {
        noteId: n.id,
        ord: c.ord,
        content: c.content,
        contentHash: c.hash,
        searchText: c.searchText,
        embedding: v?.vector ?? null,
        embeddingModel: v?.model ?? null,
      };
      await tx
        .insert(noteChunk)
        .values(values)
        .onConflictDoUpdate({
          target: [noteChunk.noteId, noteChunk.ord],
          set: {
            content: values.content,
            contentHash: values.contentHash,
            searchText: values.searchText,
            embedding: values.embedding,
            embeddingModel: values.embeddingModel,
          },
        });
    }

    const [{ unready }] = await tx
      .select({
        unready: sql<number>`count(*) filter (where ${noteChunk.embedding} is null or ${noteChunk.embeddingModel} is distinct from ${model})`,
      })
      .from(noteChunk)
      .where(eq(noteChunk.noteId, n.id));
    const status = Number(unready) === 0 ? ("ready" as const) : ("pending" as const);
    await tx.update(note).set({ indexStatus: status }).where(eq(note.id, n.id));
    return { status, embedded: vectors.size, capped };
  });
}

/**
 * Hook called after a note is created or its title/body changes, once the write has committed.
 * Never throws into the request path: on any failure the note stays `pending`, findable by keyword.
 */
export async function reindexNote(n: Note): Promise<void> {
  try {
    await indexNote(n);
  } catch (err) {
    log.warn("index.failed", { noteId: n.id, error: err instanceof Error ? err.message : String(err) });
  }
}

const REINDEX_NOTES_PER_BATCH = 5;
/** Stop starting new batches after this long, so the request finishes inside the platform timeout. */
const REINDEX_BUDGET_MS = 15_000;

/** Admin: reindex pending notes in small batches within a time budget. */
export async function reindexPending(budgetMs = REINDEX_BUDGET_MS): Promise<{ processed: number; remaining: number }> {
  const started = Date.now();
  const seen: string[] = [];
  let processed = 0;
  let capped = false;
  while (!capped && Date.now() - started < budgetMs) {
    const batch = await db()
      .select({ id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt })
      .from(note)
      .where(and(eq(note.indexStatus, "pending"), seen.length ? notInArray(note.id, seen) : undefined))
      .orderBy(asc(note.updatedAt))
      .limit(REINDEX_NOTES_PER_BATCH);
    if (batch.length === 0) break;
    for (const n of batch) {
      seen.push(n.id);
      try {
        const r = await indexNote(n);
        processed += 1;
        if (r.capped) {
          capped = true;
          break;
        }
      } catch (err) {
        log.warn("index.failed", { noteId: n.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  const [{ remaining }] = await db()
    .select({ remaining: sql<number>`count(*)` })
    .from(note)
    .where(eq(note.indexStatus, "pending"));
  return { processed, remaining: Number(remaining) };
}
