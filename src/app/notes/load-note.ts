import "server-only";
import { notFound } from "next/navigation";
import type { CurrentUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { getNote, type NoteView } from "@/lib/notes";

/** Unreadable and missing notes are the same 404, so a private id is not confirmed. */
export async function loadNoteOrNotFound(user: CurrentUser, id: string): Promise<NoteView> {
  try {
    return await getNote(user, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
