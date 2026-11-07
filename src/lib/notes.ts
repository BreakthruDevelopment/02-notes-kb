import "server-only";
import { and, asc, count, desc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { type NoteAccess, assertManage, editableBy, readableBy } from "@/lib/acl";
import { type Actor, ForbiddenError, assertCan } from "@/lib/auth/rbac";
import { db, schema } from "@/lib/db";
import type { Note } from "@/lib/db/schema";
import { BadRequestError, ConflictError, NotFoundError, TooManyRequestsError } from "@/lib/errors";
import { reindexNote } from "@/lib/indexing";
import { log } from "@/lib/log";
import {
  MAX_NOTES_PER_USER,
  SEARCH_LIMIT,
  SHARES_PER_HOUR,
  createNoteSchema,
  listQuerySchema,
  noteIdSchema,
  revokeSchema,
  searchSchema,
  shareSchema,
  updateNoteSchema,
  visibilitySchema,
} from "@/lib/notes-schemas";

const { note, noteShare, noteChunk, user, rateEvent } = schema;

export type NoteView = Pick<
  Note,
  "id" | "ownerId" | "title" | "body" | "visibility" | "indexStatus" | "createdAt" | "updatedAt"
> & { access: NoteAccess };

export type NoteListItem = Pick<Note, "id" | "ownerId" | "title" | "visibility" | "indexStatus" | "updatedAt"> & {
  ownerName: string;
  access: NoteAccess;
};

export type ShareRow = { userId: string; name: string; email: string; permission: "read" | "edit" };

/** An id that isn't a UUID can't name a note; answer 404 rather than a database error. */
function parseId(id: unknown): string {
  const parsed = noteIdSchema.safeParse(id);
  if (!parsed.success) throw new NotFoundError("Note not found");
  return parsed.data;
}

const accessSql = (actorId: string) =>
  sql<NoteAccess>`case when ${note.ownerId} = ${actorId} then 'owner' when ${editableBy(actorId)} then 'edit' else 'read' end`;

const viewColumns = (actorId: string) => ({
  id: note.id,
  ownerId: note.ownerId,
  title: note.title,
  body: note.body,
  visibility: note.visibility,
  indexStatus: note.indexStatus,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  access: accessSql(actorId),
});

/**
 * The conflict token must always move forward: now(), but never less than 1 ms past the old value,
 * so two writes in the same millisecond (or a clock step back) can't leave a stale token valid.
 */
const nextUpdatedAt = () => sql`greatest(now(), ${note.updatedAt} + interval '1 millisecond')`;

/** The one place a single note is loaded for an actor. Unreadable (or missing) is a 404. */
async function loadReadable(actor: Actor, id: string): Promise<NoteView> {
  const [row] = await db()
    .select(viewColumns(actor.id))
    .from(note)
    .where(and(eq(note.id, id), readableBy(actor.id)))
    .limit(1);
  if (!row) throw new NotFoundError("Note not found");
  return row;
}

/** Run the indexing hook after commit. It must never fail the request. */
async function afterWrite(n: Note) {
  try {
    await reindexNote(n);
  } catch (err) {
    log.warn("note.reindex_failed", { noteId: n.id, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function getNote(actor: Actor, id: string): Promise<NoteView> {
  return loadReadable(actor, parseId(id));
}

export async function listNotes(actor: Actor, tab: unknown = "mine", q?: unknown): Promise<NoteListItem[]> {
  const input = listQuerySchema.parse({ tab, q: q === null || q === "" ? undefined : q });
  const tabFilter =
    input.tab === "mine"
      ? eq(note.ownerId, actor.id)
      : input.tab === "workspace"
        ? eq(note.visibility, "workspace")
        : and(
            sql`${note.ownerId} <> ${actor.id}`,
            sql`exists (select 1 from ${noteShare} where ${noteShare.noteId} = ${note.id} and ${noteShare.userId} = ${actor.id})`,
          );
  const needle = input.q ? `%${input.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  return db()
    .select({
      id: note.id,
      ownerId: note.ownerId,
      title: note.title,
      visibility: note.visibility,
      indexStatus: note.indexStatus,
      updatedAt: note.updatedAt,
      ownerName: user.name,
      access: accessSql(actor.id),
    })
    .from(note)
    .innerJoin(user, eq(user.id, note.ownerId))
    .where(and(readableBy(actor.id), tabFilter, needle ? or(ilike(note.title, needle), ilike(note.body, needle)) : undefined))
    .orderBy(desc(note.updatedAt), asc(note.id))
    .limit(200);
}

export async function createNote(actor: Actor, input: unknown): Promise<NoteView> {
  assertCan(actor, "create");
  const data = createNoteSchema.parse(input);
  const created = await db().transaction(async (tx) => {
    // Serialize one user's creates so concurrent requests can't slip past the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"note-create:" + actor.id}, 0))`);
    const [{ n }] = await tx.select({ n: count() }).from(note).where(eq(note.ownerId, actor.id));
    if (n >= MAX_NOTES_PER_USER) {
      throw new ConflictError(`You can have at most ${MAX_NOTES_PER_USER} notes. Delete one to add another.`);
    }
    const [row] = await tx
      .insert(note)
      .values({ ownerId: actor.id, title: data.title, body: data.body, visibility: data.visibility })
      .returning();
    return row;
  });
  await afterWrite(created);
  return { ...created, access: "owner" };
}

export async function updateNote(actor: Actor, id: string, input: unknown): Promise<NoteView> {
  const noteId = parseId(id);
  const data = updateNoteSchema.parse(input);
  const current = await loadReadable(actor, noteId);
  if (current.access === "read") throw forbidden("You have read-only access to this note.");
  // Only a real visibility change is owner-only: an editor saving a form that echoes the
  // unchanged value must succeed.
  const visibilityChange = data.visibility !== undefined && data.visibility !== current.visibility ? data.visibility : undefined;
  if (visibilityChange !== undefined) assertManage(actor, current);

  const contentChanged = data.title !== undefined || data.body !== undefined;
  const rows = await db()
    .update(note)
    .set({
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(visibilityChange !== undefined ? { visibility: visibilityChange } : {}),
      // Content changes make the index stale until the hook re-embeds.
      ...(contentChanged ? { indexStatus: "pending" as const } : {}),
      updatedAt: nextUpdatedAt(),
    })
    .where(and(eq(note.id, noteId), eq(note.updatedAt, new Date(data.updatedAt)), editableBy(actor.id)))
    .returning();

  if (rows.length === 0) {
    // Stale, or access changed since we loaded it. Re-check so the status is right.
    const now = await loadReadable(actor, noteId);
    if (now.access === "read") throw forbidden("You have read-only access to this note.");
    throw new ConflictError("This note changed since you opened it. Reload to see the latest version.");
  }
  const updated = rows[0];
  if (contentChanged) await afterWrite(updated);
  return { ...updated, access: current.access };
}

export async function setVisibility(actor: Actor, id: string, visibility: unknown): Promise<NoteView> {
  const noteId = parseId(id);
  const value = visibilitySchema.parse(visibility);
  const current = await loadReadable(actor, noteId);
  assertManage(actor, current);
  const [row] = await db()
    .update(note)
    .set({ visibility: value, updatedAt: nextUpdatedAt() })
    .where(and(eq(note.id, noteId), eq(note.ownerId, actor.id)))
    .returning();
  if (!row) throw new NotFoundError("Note not found");
  return { ...row, access: "owner" };
}

export async function deleteNote(actor: Actor, id: string): Promise<void> {
  const noteId = parseId(id);
  const [row] = await db()
    .select({ ownerId: note.ownerId, visibility: note.visibility })
    .from(note)
    .where(eq(note.id, noteId))
    .limit(1);
  if (!row) throw new NotFoundError("Note not found");
  if (row.ownerId !== actor.id) {
    if (actor.role !== "admin") {
      // Someone else's note: 404 unless they can read it, then 403. Never confirm a private note exists.
      await loadReadable(actor, noteId);
    }
    assertCan(actor, "delete"); // admin only
    assertManage(actor, row, "delete");
  }
  // Chunks and shares go with the note (ON DELETE CASCADE).
  await db().delete(note).where(eq(note.id, noteId));
}

/** Owner only: the share panel's rows. */
export async function listShares(actor: Actor, id: string): Promise<ShareRow[]> {
  const noteId = parseId(id);
  const current = await loadReadable(actor, noteId);
  assertManage(actor, current);
  return db()
    .select({ userId: user.id, name: user.name, email: user.email, permission: noteShare.permission })
    .from(noteShare)
    .innerJoin(user, eq(user.id, noteShare.userId))
    .where(eq(noteShare.noteId, noteId))
    .orderBy(asc(user.email));
}

/**
 * The same body whether or not the email belongs to a user. That is not enough on its own: the
 * owner's share list shows which emails matched, so the hourly rate limit is the real control
 * against probing for accounts.
 */
export type ShareResult = { shared: true };

export async function shareNote(actor: Actor, id: string, input: unknown): Promise<ShareResult> {
  const noteId = parseId(id);
  const data = shareSchema.parse(input);
  const current = await loadReadable(actor, noteId);
  assertManage(actor, current);

  // Record every attempt, known email or not, and refuse the 31st in a rolling hour.
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"share:" + actor.id}, 0))`);
    // Rows past the window can never count again; drop them.
    await tx
      .delete(rateEvent)
      .where(
        and(eq(rateEvent.userId, actor.id), eq(rateEvent.kind, "share"), sql`${rateEvent.at} <= now() - interval '1 hour'`),
      );
    const [{ n }] = await tx
      .select({ n: count() })
      .from(rateEvent)
      .where(
        and(
          eq(rateEvent.userId, actor.id),
          eq(rateEvent.kind, "share"),
          gt(rateEvent.at, sql`now() - interval '1 hour'`),
        ),
      );
    if (n >= SHARES_PER_HOUR) throw new TooManyRequestsError("Too many share attempts. Try again in a while.");
    await tx.insert(rateEvent).values({ userId: actor.id, kind: "share" });
  });

  const [target] = await db()
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${data.email})`)
    .limit(1);
  if (target) {
    if (target.id === actor.id) throw new BadRequestError("You can't share a note with yourself.");
    await db()
      .insert(noteShare)
      .values({ noteId, userId: target.id, permission: data.permission })
      .onConflictDoUpdate({ target: [noteShare.noteId, noteShare.userId], set: { permission: data.permission } });
  }
  return { shared: true };
}

export async function revokeShare(actor: Actor, id: string, input: unknown): Promise<void> {
  const noteId = parseId(id);
  const data = revokeSchema.parse(input);
  const current = await loadReadable(actor, noteId);
  assertManage(actor, current);
  await db().delete(noteShare).where(and(eq(noteShare.noteId, noteId), eq(noteShare.userId, data.userId)));
}

export type NoteMeta = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  /** null when the note is private and unshared: the UI shows "Private note". */
  title: string | null;
  visibility: "private" | "workspace";
  shareCount: number;
  indexStatus: "ready" | "pending";
  updatedAt: Date;
};

/** Admin only. Metadata for every note: never the body or chunks, and no title for private unshared notes. */
export async function listAllNoteMeta(actor: Actor): Promise<NoteMeta[]> {
  assertCan(actor, "read"); // without a resource, only admin passes
  const shareCount = sql<number>`(select count(*)::int from ${noteShare} where ${noteShare.noteId} = ${note.id})`;
  return db()
    .select({
      id: note.id,
      ownerId: note.ownerId,
      ownerName: user.name,
      ownerEmail: user.email,
      title: sql<string | null>`case when ${note.visibility} = 'workspace' or ${shareCount} > 0 then ${note.title} else null end`,
      visibility: note.visibility,
      shareCount,
      indexStatus: note.indexStatus,
      updatedAt: note.updatedAt,
    })
    .from(note)
    .innerJoin(user, eq(user.id, note.ownerId))
    .orderBy(desc(note.updatedAt), asc(note.id))
    .limit(500);
}

export type SearchHit = { noteId: string; title: string; snippet: string };

/**
 * Keyword search over notes the actor can read: full text over chunks, plus a title match for notes
 * that have no chunks yet (not indexed, still findable).
 */
export async function keywordSearch(actor: Actor, q: unknown): Promise<SearchHit[]> {
  const { q: query } = searchSchema.parse({ q });
  const tsq = sql`websearch_to_tsquery('english', ${query})`;

  // Rank and cut to the top 20 notes first; ts_headline is expensive, so it runs only on those.
  const chunkHits = await db().execute<{ note_id: string; title: string; snippet: string }>(sql`
    select best.note_id, best.title,
      ts_headline('english', best.content, ${tsq}, 'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=1') as snippet
    from (
      select distinct on (${note.id}) ${note.id} as note_id, ${note.title} as title, ${noteChunk.content} as content,
        ts_rank(${noteChunk.tsv}, ${tsq}) as rank
      from ${noteChunk}
      inner join ${note} on ${note.id} = ${noteChunk.noteId}
      where ${readableBy(actor.id)} and ${noteChunk.tsv} @@ ${tsq}
      order by ${note.id}, rank desc
    ) best
    order by best.rank desc, best.note_id
    limit ${SEARCH_LIMIT}
  `);
  const hits: SearchHit[] = [...chunkHits].map((r) => ({ noteId: r.note_id, title: r.title, snippet: r.snippet }));
  if (hits.length < SEARCH_LIMIT) {
    const needle = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const titleHits = await db()
      .select({ noteId: note.id, title: note.title, snippet: sql<string>`left(${note.body}, 160)` })
      .from(note)
      .where(
        and(
          readableBy(actor.id),
          ilike(note.title, needle),
          sql`not exists (select 1 from ${noteChunk} where ${noteChunk.noteId} = ${note.id})`,
        ),
      )
      .orderBy(desc(note.updatedAt))
      .limit(SEARCH_LIMIT);
    const seen = new Set(hits.map((h) => h.noteId));
    for (const h of titleHits) {
      if (hits.length >= SEARCH_LIMIT) break;
      if (!seen.has(h.noteId)) hits.push(h);
    }
  }
  return hits;
}

function forbidden(message: string): Error {
  return new ForbiddenError(message);
}
