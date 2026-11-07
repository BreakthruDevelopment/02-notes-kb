"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createNoteAction, updateNoteAction } from "@/app/actions/notes";
import { emptyFormState } from "@/app/actions/form-state";
import { MarkdownView } from "@/components/notes/markdown-view";
import { buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui/styles";
import { BODY_MAX, TITLE_MAX } from "@/lib/notes-schemas";

type EditorNote = {
  id: string;
  title: string;
  body: string;
  visibility: "private" | "workspace";
  updatedAt: string;
  canChangeVisibility: boolean;
};

type Props =
  | { mode: "create"; cancelHref: string; note?: undefined }
  | { mode: "edit"; cancelHref: string; note: EditorNote };

export function NoteForm({ mode, cancelHref, note }: Props) {
  const action = mode === "create" ? createNoteAction : updateNoteAction.bind(null, note.id);
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [body, setBody] = useState(note?.body ?? "");
  // Controlled so a failed save (409 conflict, validation error) doesn't reset what the user typed:
  // React resets uncontrolled fields after every form action.
  const [title, setTitle] = useState(note?.title ?? "");
  const [visibility, setVisibility] = useState<"private" | "workspace">(note?.visibility ?? "private");
  const conflict = state.error?.includes("changed since you opened it") ?? false;

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      {mode === "edit" && <input type="hidden" name="updatedAt" value={note.updatedAt} />}
      <input type="hidden" name="body" value={body} />
      <label className={labelClass}>
        <span>Title</span>
        <input
          name="title"
          required
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          autoComplete="off"
          className={inputClass}
        />
      </label>
      {(mode === "create" || note.canChangeVisibility) && (
        <label className={labelClass}>
          <span>Visibility</span>
          <select
            name="visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "private" | "workspace")}
            disabled={pending}
            className={inputClass}
          >
            <option value="private">Private</option>
            <option value="workspace">Workspace</option>
          </select>
          <span className="text-sm font-normal text-muted">
            Private notes are visible to you and the people you share them with. Workspace notes are visible to
            everyone signed in.
          </span>
        </label>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span className="text-sm font-medium" id="note-body-label">
            Body
          </span>
          <div role="tablist" aria-labelledby="note-body-label" className="flex flex-wrap gap-2">
            <button
              type="button"
              role="tab"
              id="note-write-tab"
              aria-selected={tab === "write"}
              aria-controls="note-write"
              onClick={() => setTab("write")}
              className={tab === "write" ? buttonPrimary : buttonSecondary}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              id="note-preview-tab"
              aria-selected={tab === "preview"}
              aria-controls="note-preview"
              onClick={() => setTab("preview")}
              className={tab === "preview" ? buttonPrimary : buttonSecondary}
            >
              Preview
            </button>
          </div>
        </div>
        <div id="note-write" role="tabpanel" aria-labelledby="note-write-tab" hidden={tab !== "write"}>
          <textarea
            aria-labelledby="note-body-label"
            value={body}
            maxLength={BODY_MAX}
            disabled={pending}
            onChange={(event) => setBody(event.target.value)}
            className={`${inputClass} min-h-48 resize-y leading-relaxed`}
          />
          <p className="mt-1 text-sm text-muted">
            Markdown. {body.length.toLocaleString("en-US")} / {BODY_MAX.toLocaleString("en-US")} characters.
          </p>
        </div>
        <div
          id="note-preview"
          role="tabpanel"
          aria-labelledby="note-preview-tab"
          hidden={tab !== "preview"}
          className="min-h-48 rounded-card border border-border bg-background p-4"
        >
          {body.trim() ? <MarkdownView source={body} /> : <p className="text-muted">Nothing to preview yet.</p>}
        </div>
      </div>
      {state.error && (
        <div role="alert" className="space-y-2">
          <p className="break-words text-sm font-medium text-danger">{state.error}</p>
          {conflict && mode === "edit" && (
            <a href={`/notes/${note.id}/edit`} className="inline-flex min-h-11 items-center font-semibold text-accent underline">
              Reload the latest version
            </a>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={`${buttonPrimary} w-full sm:w-auto`}>
          {pending ? "Saving…" : mode === "create" ? "Create note" : "Save changes"}
        </button>
        <Link href={cancelHref} className={`${buttonSecondary} w-full sm:w-auto`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
