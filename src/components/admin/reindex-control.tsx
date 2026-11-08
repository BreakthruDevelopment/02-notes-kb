"use client";

import { useActionState } from "react";
import { reindexPendingAction } from "@/app/actions/admin";
import { emptyReindexState } from "@/components/admin/state";
import { buttonPrimary } from "@/components/ui/styles";

export function ReindexControl() {
  const [state, action, pending] = useActionState(reindexPendingAction, emptyReindexState);

  return (
    <form action={action} className="space-y-3" aria-busy={pending}>
      <div>
        <h3 className="font-semibold">Reindex pending</h3>
        <p className="text-sm text-muted">Embed notes that are still waiting, within today&apos;s cap.</p>
      </div>
      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full sm:w-auto`}>
        {pending ? "Reindexing…" : "Reindex pending"}
      </button>
      {state.error && (
        <p role="alert" className="break-words text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      {state.remaining !== null && (
        <p role="status" className="text-sm">
          Indexed {state.processed ?? 0}. {state.remaining} remaining.
        </p>
      )}
    </form>
  );
}
