"use client";

import { useActionState, useEffect, useRef } from "react";
import { revokeShareAction, shareNoteAction } from "@/app/actions/notes";
import { emptyFormState, type FormState } from "@/app/actions/form-state";
import { buttonDanger, buttonPrimary, inputClass, labelClass } from "@/components/ui/styles";

export type ShareListItem = { userId: string; name: string; email: string; permission: "read" | "edit" };

function FormMessage({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm font-medium text-danger">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-sm text-muted">
        {state.message}
      </p>
    );
  }
  return null;
}

function ShareRow({ noteId, share }: { noteId: string; share: ShareListItem }) {
  const [state, action, pending] = useActionState(revokeShareAction.bind(null, noteId), emptyFormState);
  const permission = share.permission === "edit" ? "Can edit" : "Can read";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="break-words font-medium">{share.name}</p>
        <p className="break-all text-sm text-muted">{share.email}</p>
        <p className="text-sm text-muted">{permission}</p>
      </div>
      <form action={action}>
        <input type="hidden" name="userId" value={share.userId} />
        <button
          type="submit"
          disabled={pending}
          className={buttonDanger}
          aria-label={`Remove access for ${share.email}`}
        >
          {pending ? "Removing…" : "Remove"}
        </button>
      </form>
      {(state.error || state.message) && (
        <div className="basis-full">
          <FormMessage state={state} />
        </div>
      )}
    </li>
  );
}

export function SharePanel({ noteId, shares }: { noteId: string; shares: ShareListItem[] }) {
  const [state, action, pending] = useActionState(shareNoteAction.bind(null, noteId), emptyFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state.message) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state.message]);

  return (
    <div className="space-y-4">
      {shares.length === 0 ? (
        <p className="text-sm text-muted">No one else can open this note yet.</p>
      ) : (
        <ul className="divide-y divide-border">{shares.map((share) => <ShareRow key={share.userId} noteId={noteId} share={share} />)}</ul>
      )}
      <form ref={formRef} action={action} className="space-y-3">
        <label className={labelClass}>
          <span>Email</span>
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            disabled={pending}
            placeholder="teammate@example.com"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>Permission</span>
          <select name="permission" defaultValue="read" disabled={pending} className={inputClass}>
            <option value="read">Can read</option>
            <option value="edit">Can edit</option>
          </select>
        </label>
        <FormMessage state={state} />
        <button type="submit" disabled={pending} className={`${buttonPrimary} w-full sm:w-auto`}>
          {pending ? "Sharing…" : "Share note"}
        </button>
      </form>
    </div>
  );
}
