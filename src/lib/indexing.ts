import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, notInArray, or, sql, type SQL } from "drizzle-orm";
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
  // Demo embeddings are free, so they are neither capped nor counted.
  const metered = model !== DEMO_EMBED_MODEL;
  const vectors = new Map<number, { vector: number[]; model: string }>();
  let capped = false;
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH);
    if (metered && !(await reserveUsage("embed", batch.length, env().EMBED_DAILY_CHUNKS))) {
      capped = true;
      log.warn("index.embed_cap_reached", { noteId: n.id, chunks: batch.length });
      break;
    }
    let res: Awaited<ReturnType<typeof embed>>;
    try {
      res = await embed({ task: "embed-note", texts: batch.map((c) => c.searchText), kind: "document" });
    } catch (err) {
      if (metered) await refundUsage("embed", batch.length).catch(() => undefined);
      log.warn("index.embed_failed", { noteId: n.id, chunks: batch.length, error: err instanceof Error ? err.message : String(err) });
      break;
    }
    // The gateway fell back to the free demo provider: nothing was spent, so give the reservation back.
    if (metered && res.demo) await refundUsage("embed", batch.length).catch(() => undefined);
    batch.forEach((c, k) => vectors.set(c.ord, { vector: res.vectors[k], model: res.model }));
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
 * Returns the note's index status afterwards, so the caller's response can reflect it.
 */
export async function reindexNote(n: Note): Promise<Note["indexStatus"]> {
  try {
    const r = await indexNote(n);
    return r.status === "ready" ? "ready" : "pending";
  } catch (err) {
    log.warn("index.failed", { noteId: n.id, error: err instanceof Error ? err.message : String(err) });
    return "pending";
  }
}

const REINDEX_NOTES_PER_BATCH = 5;
/** Stop starting new batches after this long, so the request finishes inside the platform timeout. */
const REINDEX_BUDGET_MS = 15_000;
/** And stop after about this many chunks per call (one call = one admin click on a small instance). */
export const REINDEX_MAX_CHUNKS = 50;

/**
 * Notes that need work: marked pending, or holding any chunk without a vector for the current model (for example
 * notes embedded in demo mode, once a Gemini key is added).
 */
function needsIndexing(model: string): SQL {
  return or(
    eq(note.indexStatus, "pending"),
    sql`exists (select 1 from ${noteChunk} where ${noteChunk.noteId} = ${note.id} and (${noteChunk.embedding} is null or ${noteChunk.embeddingModel} is distinct from ${model}))`,
  ) as SQL;
}

/** Admin: reindex notes that need it in small batches, within a time budget and a chunk budget. */
export async function reindexPending(budgetMs = REINDEX_BUDGET_MS): Promise<{ processed: number; remaining: number }> {
  const started = Date.now();
  const model = expectedEmbedModel();
  const seen: string[] = [];
  let processed = 0;
  let chunks = 0;
  let stop = false;
  while (!stop && Date.now() - started < budgetMs) {
    const batch = await db()
      .select({ id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt })
      .from(note)
      .where(and(needsIndexing(model), seen.length ? notInArray(note.id, seen) : undefined))
      .orderBy(asc(note.updatedAt))
      .limit(REINDEX_NOTES_PER_BATCH);
    if (batch.length === 0) break;
    for (const n of batch) {
      // chunkMarkdown is an upper bound on what this note can embed; always do at least one note per call.
      const size = chunkMarkdown(n.body).length;
      if (processed > 0 && chunks + size > REINDEX_MAX_CHUNKS) {
        stop = true;
        break;
      }
      seen.push(n.id);
      try {
        const r = await indexNote(n);
        processed += 1;
        chunks += size;
        if (r.capped) {
          stop = true;
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
    .where(needsIndexing(model));
  return { processed, remaining: Number(remaining) };
}
