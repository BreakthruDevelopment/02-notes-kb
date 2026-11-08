import { DemoBadge } from "@/components/ui/DemoBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { AskMode } from "./state";

/** How the answer was produced: a live model, the recorded demo, or keyword fallback. */
export function ModeBadge({ mode }: { mode: AskMode }) {
  if (mode === "demo") return <DemoBadge label="Demo" />;
  if (mode === "keyword") return <StatusBadge status="building" label="Keyword" />;
  return <StatusBadge status="live" label="Live" />;
}
