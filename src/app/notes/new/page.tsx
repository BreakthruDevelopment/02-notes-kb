import type { Metadata } from "next";
import { DemoDataBanner } from "@/components/notes/demo-banner";
import { NoteForm } from "@/components/notes/note-form";
import { PageIntro, Panel } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New note" };
export const dynamic = "force-dynamic";

export default async function NewNotePage() {
  await requireUserOrRedirect();
  return (
    <>
      <DemoDataBanner />
      <PageIntro
        section="Notes"
        title="New note"
        description="Write a Markdown note. It stays private until you share it or make it a workspace note."
      />
      <Panel title="Note">
        <NoteForm mode="create" cancelHref="/notes" />
      </Panel>
    </>
  );
}
