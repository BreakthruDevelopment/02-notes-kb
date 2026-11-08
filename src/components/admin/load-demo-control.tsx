"use client";

import { useActionState, useState } from "react";
import { loadDemoWorkspaceAction } from "@/app/actions/admin";
import { emptyDemoState } from "@/components/admin/state";
import { buttonPrimary, buttonSecondary } from "@/components/ui/styles";

export function LoadDemoControl() {
  const [state, action, pending] = useActionState(loadDemoWorkspaceAction, emptyDemoState);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">Load demo workspace</h3>
        <p className="text-sm text-muted">
          Replaces the demo people&apos;s notes and signs them out. Other accounts are left alone.
        </p>
      </div>
      {confirming ? (
        <form action={action} className="space-y-3" aria-busy={pending}>
          <p className="break-words text-sm">Load the demo workspace now?</p>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={pending} className={`${buttonPrimary} w-full sm:w-auto`}>
              {pending ? "Loading…" : "Load demo workspace"}
            </button>
            <button
              type="button"
              disabled={pending}
              className={`${buttonSecondary} w-full sm:w-auto`}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={`${buttonSecondary} w-full sm:w-auto`} onClick={() => setConfirming(true)}>
          Load demo workspace
        </button>
      )}
      {state.error && (
        <p role="alert" className="break-words text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="break-words text-sm">
          {state.message}
        </p>
      )}
    </div>
  );
}
