import { StatusBadge } from "@/components/ui";

/**
 * Visibility as words. Private stays on the neutral status so it never reads as an error.
 * Workspace uses the live token because every signed-in person can read it.
 */
export function VisibilityBadge({ visibility }: { visibility: "private" | "workspace" }) {
  if (visibility === "workspace") return <StatusBadge status="live" label="Workspace" />;
  return <StatusBadge status="not-started" label="Private" />;
}
