import type { Metadata } from "next";
import Link from "next/link";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { formatWhen } from "@/components/notes/format";
import { IndexPendingNotice } from "@/components/notes/index-pending-notice";
import { MarkdownView } from "@/components/notes/markdown-view";
import { SharePanel } from "@/components/notes/share-panel";
import { VisibilityBadge } from "@/components/notes/visibility-badge";
import { PageIntro, Panel, buttonPrimary } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { listShares } from "@/lib/notes";
import { loadNoteOrNotFound } from "../load-note";

export const metadata: Metadata = { title: "Note" };
export const dynamic = "force-dynamic";

function accessLine(access: "owner" | "edit" | "read"): string {
  if (access === "owner") return "You own this note.";
  if (access === "edit") return "You can edit this note.";
  return "You can read this note.";
}

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUserOrRedirect();
  const { id } = await params;
  const note = await loadNoteOrNotFound(user, id);
  const shares = note.access === "owner" ? await listShares(user, id) : null;
  const canEdit = note.access === "owner" || note.access === "edit";

  return (
    <>
      <PageIntro
        section="Notes"
        title={note.title}
        description={`${accessLine(note.access)} Updated ${formatWhen(note.updatedAt)}.`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <VisibilityBadge visibility={note.visibility} />
      </div>
      {note.indexStatus === "pending" && <IndexPendingNotice />}
      <div className="mb-6 flex max-w-full flex-wrap items-center gap-3">
        {canEdit && (
          <Link href={`/notes/${note.id}/edit`} className={buttonPrimary}>
            Edit
          </Link>
        )}
        {note.access === "owner" && <DeleteNoteButton noteId={note.id} />}
      </div>
      <Panel title="Note">
        <MarkdownView source={note.body} />
      </Panel>
      {shares && (
        <Panel title="Sharing" count={shares.length}>
          <SharePanel noteId={note.id} shares={shares} />
        </Panel>
      )}
    </>
  );
}
