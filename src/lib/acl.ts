import { type SQL, sql } from "drizzle-orm";
import { type Actor, ForbiddenError } from "@/lib/auth/rbac";
import { note, noteShare } from "@/lib/db/schema";

/**
 * The note ACL, written once. Every list, get, search and retrieval query puts
 * `readableBy(actorId)` in its WHERE clause, so an unreadable note is never fetched.
 * The fragments reference the `note` table, so the query must select from it unaliased.
 *
 * - readable: owner, or workspace-visible, or a share row for the actor
 * - editable: owner, or a share row with permission 'edit'
 * - manage (share, revoke, visibility, delete): owner; admin may also delete
 *
 * Admin is not a bypass for reading: admin reads through the same fragment as everyone.
 */
export function readableBy(actorId: string): SQL {
  return sql`(${note.ownerId} = ${actorId} or ${note.visibility} = 'workspace' or exists (select 1 from ${noteShare} where ${noteShare.noteId} = ${note.id} and ${noteShare.userId} = ${actorId}))`;
}

export function editableBy(actorId: string): SQL {
  return sql`(${note.ownerId} = ${actorId} or exists (select 1 from ${noteShare} where ${noteShare.noteId} = ${note.id} and ${noteShare.userId} = ${actorId} and ${noteShare.permission} = 'edit'))`;
}

/** What the actor can do with a note they already loaded, for the in-memory side of the same rules. */
export type NoteAccess = "owner" | "edit" | "read";

type PolicyNote = { ownerId: string; visibility: "private" | "workspace" };
type Grant = "read" | "edit" | null;

export function noteAccess(actor: Actor, n: PolicyNote, grant: Grant): NoteAccess | null {
  if (n.ownerId === actor.id) return "owner";
  if (grant === "edit") return "edit";
  if (grant === "read" || n.visibility === "workspace") return "read";
  return null;
}

export const canReadNote = (actor: Actor, n: PolicyNote, grant: Grant) => noteAccess(actor, n, grant) !== null;

export function canEditNote(actor: Actor, n: PolicyNote, grant: Grant) {
  const a = noteAccess(actor, n, grant);
  return a === "owner" || a === "edit";
}

/** Share, revoke, set visibility: the owner only. Delete also allows admin. */
export function canManageNote(actor: Actor, n: PolicyNote, op: "manage" | "delete" = "manage") {
  if (n.ownerId === actor.id) return true;
  return op === "delete" && actor.role === "admin";
}

export function assertManage(actor: Actor, n: PolicyNote, op: "manage" | "delete" = "manage"): void {
  if (!canManageNote(actor, n, op)) throw new ForbiddenError("Only the note's owner can do that.");
}
