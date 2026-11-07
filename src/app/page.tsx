import Link from "next/link";
import { PageIntro, Panel, buttonPrimary, buttonSecondary } from "@/components/ui";

const features = [
  { title: "Write and share", body: "Keep notes private by default, then share a note with a teammate as read-only or editable." },
  { title: "Search", body: "Find notes by keyword or by meaning, limited to the notes you are allowed to see." },
  { title: "Ask your notes", body: "Ask a question and get an answer that cites the notes it came from. Without a model key it runs in demo mode." },
  { title: "Private by design", body: "Every read, search and answer is checked against who is asking, on the server." },
];

export default function Home() {
  return (
    <>
      <PageIntro
        section="Notes"
        title="A notes wiki you can ask questions of."
        description="Write notes, search them, and ask questions answered from what you wrote."
        actions={
          <>
            <Link href="/notes" className={buttonPrimary}>
              Open notes
            </Link>
            <Link href="/api/health" className={buttonSecondary}>
              Health check
            </Link>
          </>
        }
      />
      <div className="grid gap-x-4 sm:grid-cols-2">
        {features.map((f) => (
          <Panel key={f.title} title={f.title}>
            <p className="text-muted">{f.body}</p>
          </Panel>
        ))}
      </div>
    </>
  );
}
