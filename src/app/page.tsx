import Link from "next/link";
import { DemoDataBanner } from "@/components/notes/demo-banner";
import { PageIntro, Panel, buttonPrimary, buttonSecondary } from "@/components/ui";

const features = [
  {
    title: "Write and share",
    body: "Keep notes private by default, then share a note with a teammate as read-only or editable.",
  },
  {
    title: "Search",
    body: "Find notes by keyword, limited to the notes you are allowed to see.",
  },
  {
    title: "Ask your notes",
    body: "Ask a question and get an answer that cites the notes it came from. Without a model key it runs in demo mode.",
  },
  {
    title: "Private by design",
    body: "Every read, search, and answer is checked against who is asking, on the server.",
  },
];

export default function Home() {
  return (
    <>
      <DemoDataBanner />
      <PageIntro
        section="Notes"
        title="A notes wiki you can ask questions of."
        description="Write notes, share the ones you choose, and ask questions answered only from notes you can read."
        actions={
          <>
            <Link href="/sign-in" className={buttonPrimary}>
              Sign in
            </Link>
            <Link href="/notes" className={buttonSecondary}>
              Open notes
            </Link>
          </>
        }
      />
      <div className="grid gap-x-4 sm:grid-cols-2">
        {features.map((feature) => (
          <Panel key={feature.title} title={feature.title}>
            <p className="text-muted">{feature.body}</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
