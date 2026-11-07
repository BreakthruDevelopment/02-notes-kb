import type { Metadata } from "next";
import { requireUserOrRedirect } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

// Placeholder. The notes list UI is built in the UI issue.
export default async function NotesPage() {
  await requireUserOrRedirect();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
      <p className="text-sm text-muted">Your notes will appear here.</p>
    </div>
  );
}
