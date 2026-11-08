import type { Metadata } from "next";
import { AskForm } from "@/components/ask/ask-form";
import { DemoDataBanner } from "@/components/notes/demo-banner";
import { PageIntro, Panel } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ask" };
export const dynamic = "force-dynamic";
export const maxDuration = 25;

export default async function AskPage() {
  await requireUserOrRedirect();

  return (
    <>
      <DemoDataBanner />
      <PageIntro
        section="Ask"
        title="Ask"
        description="Ask a question. The answer uses only notes you can read, and cites them."
      />
      <Panel title="Question">
        <AskForm />
      </Panel>
    </>
  );
}
