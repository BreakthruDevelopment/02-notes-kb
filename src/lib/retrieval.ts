import "server-only";
import { sql } from "drizzle-orm";
import { readableBy } from "@/lib/acl";
import { DEMO_EMBED_MODEL } from "@/lib/ai";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

const { note, noteChunk } = schema;

export const RAG_TOP_K = 6;
/**
 * Demo vectors are hashed bag-of-words: a natural-language question that shares most of its content words with a
 * chunk still sits around 0.5-0.6 away, because stop words count too. Live-model distances are tuned with
 * RAG_MAX_DISTANCE; for the demo model the cut is never tighter than this, so offline demos answer.
 */
export const DEMO_MIN_MAX_DISTANCE = 0.65;

export type SourceChunk = { noteId: string; title: string; content: string };

let iterativeScan: Promise<boolean> | undefined;

/** pgvector 0.8 added `hnsw.iterative_scan`. Detected once per process; the server's version is unknown in advance. */
export function supportsIterativeScan(): Promise<boolean> {
  iterativeScan ??= db()
    .execute<{ extversion: string }>(sql`select extversion from pg_extension where extname = 'vector'`)
    .then((rows) => {
      const [major = 0, minor = 0] = (rows[0]?.extversion ?? "0.0").split(".").map(Number);
      return major > 0 || minor >= 8;
    })
    .catch((err) => {
      iterativeScan = undefined; // try again next time
      throw err;
    });
  return iterativeScan;
}

/** For tests. */
export function resetPgvectorProbe() {
  iterativeScan = undefined;
}

const vectorLiteral = (v: number[]) => sql`${JSON.stringify(v)}::vector`;

/**
 * Cosine retrieval over chunks the actor can read, in ONE query. The ACL fragment sits in the same WHERE as the
 * ordering, so a chunk the actor can't read is never fetched, not filtered afterwards. Only chunks embedded with
 * `model` are compared (demo and live vectors never mix). With pgvector >= 0.8 an iterative index scan keeps the
 * ACL filter from starving the top 6; before that, a wider `ef_search` does the job.
 */
export async function retrieveChunks(actorId: string, queryVector: number[], model: string): Promise<SourceChunk[]> {
  const iterative = await supportsIterativeScan();
  const maxDistance = model === DEMO_EMBED_MODEL ? Math.max(env().RAG_MAX_DISTANCE, DEMO_MIN_MAX_DISTANCE) : env().RAG_MAX_DISTANCE;
  const q = vectorLiteral(queryVector);

  return db().transaction(async (tx) => {
    await tx.execute(
      iterative ? sql.raw("set local hnsw.iterative_scan = relaxed_order") : sql.raw("set local hnsw.ef_search = 100"),
    );
    // relaxed_order can return rows slightly out of order, so the outer query sorts and applies the distance cut.
    const rows = await tx.execute<{ note_id: string; title: string; content: string }>(sql`
      select top.note_id, top.title, top.content
      from (
        select ${note.id} as note_id, ${note.title} as title, ${noteChunk.content} as content,
          ${noteChunk.embedding} <=> ${q} as distance
        from ${noteChunk}
        inner join ${note} on ${note.id} = ${noteChunk.noteId}
        where ${readableBy(actorId)}
          and ${noteChunk.embeddingModel} = ${model}
          and ${noteChunk.embedding} is not null
        order by ${noteChunk.embedding} <=> ${q}
        limit ${RAG_TOP_K}
      ) top
      where top.distance <= ${maxDistance}
      order by top.distance, top.note_id
    `);
    return [...rows].map((r) => ({ noteId: r.note_id, title: r.title, content: r.content }));
  });
}

/** True when the actor can read chunks that vector search can't use with `model` (other model, or not embedded yet). */
export async function hasUnsearchableChunks(actorId: string, model: string): Promise<boolean> {
  const rows = await db().execute<{ found: boolean }>(sql`
    select exists (
      select 1 from ${noteChunk} inner join ${note} on ${note.id} = ${noteChunk.noteId}
      where ${readableBy(actorId)}
        and (${noteChunk.embedding} is null or ${noteChunk.embeddingModel} is distinct from ${model})
    ) as found
  `);
  return Boolean(rows[0]?.found);
}

/** Words of a question as an OR query, so a natural-language question matches chunks sharing any of its terms. */
export function orQuery(question: string): string | null {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 12);
  return words.length ? words.join(" | ") : null;
}

/** Keyword fallback: top chunks by full-text rank among chunks the actor can read. */
export async function keywordChunks(actorId: string, question: string): Promise<SourceChunk[]> {
  const terms = orQuery(question);
  if (!terms) return [];
  const tsq = sql`to_tsquery('english', ${terms})`;
  const rows = await db().execute<{ note_id: string; title: string; content: string }>(sql`
    select ${note.id} as note_id, ${note.title} as title, ${noteChunk.content} as content
    from ${noteChunk}
    inner join ${note} on ${note.id} = ${noteChunk.noteId}
    where ${readableBy(actorId)} and ${noteChunk.tsv} @@ ${tsq}
    order by ts_rank(${noteChunk.tsv}, ${tsq}) desc, ${note.id}, ${noteChunk.ord}
    limit ${RAG_TOP_K}
  `);
  return [...rows].map((r) => ({ noteId: r.note_id, title: r.title, content: r.content }));
}
