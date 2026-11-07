import type { Metadata } from "next";
import Link from "next/link";
import { IndexPendingNotice } from "@/components/notes/index-pending-notice";
import { NoteForm } from "@/components/notes/note-form";
import { VisibilityBadge } from "@/components/notes/visibility-badge";
import { PageIntro, Panel, buttonPrimary } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { loadNoteOrNotFound } from "../../load-note";

export const metadata: Metadata = { title: "Edit note" };
export const dynamic = "force-dynamic";

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserOrRedirect();
  const { id } = await params;
  const note = await loadNoteOrNotFound(user, id);

  if (note.access === "read") {
    return (
      <>
        <PageIntro
          section="Notes"
          title={note.title}
          description="You can read this note. Only the owner or someone with edit access can change it."
        />
        <div className="mb-6">
          <VisibilityBadge visibility={note.visibility} />
        </div>
        <Link href={`/notes/${note.id}`} className={buttonPrimary}>
          View note
        </Link>
      </>
    );
  }

  return (
    <>
      <PageIntro
        section="Notes"
        title={note.title}
        description={
          note.access === "owner"
            ? "Update the title, the Markdown body, or who can read this note."
            : "Update the title or the Markdown body."
        }
      />
      <div className="mb-4">
        <VisibilityBadge visibility={note.visibility} />
      </div>
      {note.indexStatus === "pending" && <IndexPendingNotice />}
      <Panel title="Editor">
        <NoteForm
          mode="edit"
          cancelHref={`/notes/${note.id}`}
          note={{
            id: note.id,
            title: note.title,
            body: note.body,
            visibility: note.visibility,
            updatedAt: note.updatedAt.toISOString(),
            canChangeVisibility: note.access === "owner",
          }}
        />
      </Panel>
    </>
  );
}
