import type { Metadata } from "next";
import { PageIntro, Panel } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

// Placeholder. The notes list UI is built in the UI issue.
export default async function NotesPage() {
  await requireUserOrRedirect();
  return (
    <>
      <PageIntro section="Notes" title="Notes" description="Write notes, search them, and ask questions of them." />
      <Panel title="Your notes">
        <p className="text-muted">Your notes will appear here.</p>
      </Panel>
    </>
  );
}
