import { DemoBadge } from "@/components/ui";

/** Demo-data warning for the public landing page and the new-note form. */
export function DemoDataBanner() {
  return (
    <div
      role="note"
      className="mb-6 flex max-w-full flex-wrap items-center gap-3 rounded-card border border-border bg-surface px-4 py-3"
    >
      <DemoBadge />
      <p className="min-w-0 flex-1 text-sm text-foreground">Demo data only. Do not store confidential notes.</p>
    </div>
  );
}
