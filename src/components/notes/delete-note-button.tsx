"use client";

import { useActionState, useState } from "react";
import { deleteNoteAction } from "@/app/actions/notes";
import { emptyFormState } from "@/app/actions/form-state";
import { buttonDanger, buttonSecondary } from "@/components/ui/styles";

export function DeleteNoteButton({ noteId }: { noteId: string }) {
  const [state, action, pending] = useActionState(deleteNoteAction.bind(null, noteId), emptyFormState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className={buttonDanger} onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="flex max-w-full flex-wrap items-center gap-3">
      <p className="min-w-0 break-words text-sm">Delete this note permanently?</p>
      <button type="submit" disabled={pending} className={buttonDanger}>
        {pending ? "Deleting…" : "Delete note"}
      </button>
      <button type="button" disabled={pending} className={buttonSecondary} onClick={() => setConfirming(false)}>
        Cancel
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
