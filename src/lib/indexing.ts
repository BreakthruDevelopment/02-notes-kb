import type { Note } from "@/lib/db/schema";

/**
 * Hook called after a note is created or its title/body changes, once the write has committed.
 * Issue 5 fills this in (chunk, embed changed chunks, mark the note ready). Callers wrap it so a
 * failure here never reaches the request: the note stays `pending` and findable by keyword.
 */
export async function reindexNote(note: Note): Promise<void> {
  void note;
}
