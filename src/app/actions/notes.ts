"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/actions/form-state";
import { requireUser } from "@/lib/auth/session";
import { errorInfo } from "@/lib/http";
import * as notes from "@/lib/notes";

/**
 * Server actions for the notes UI. They run the same data functions as the API routes, after
 * requireUser(), and return form state instead of throwing, because production builds hide
 * thrown error messages from the client. Next checks the Origin of server action requests.
 */

/** Prefer the first field error ("Title is required") over the generic "Invalid input". */
function failed(err: unknown): FormState {
  const { body } = errorInfo(err);
  if (Array.isArray(body.issues)) {
    for (const issue of body.issues) {
      if (issue && typeof issue === "object" && "message" in issue && typeof issue.message === "string" && issue.message) {
        return { error: issue.message, message: null };
      }
    }
  }
  return { error: body.error, message: null };
}

function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

export async function createNoteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let id: string;
  try {
    const user = await requireUser();
    const created = await notes.createNote(user, {
      title: text(formData, "title"),
      body: text(formData, "body"),
      visibility: text(formData, "visibility") || "private",
    });
    id = created.id;
  } catch (err) {
    return failed(err);
  }
  revalidatePath("/notes");
  redirect(`/notes/${id}`);
}

export async function updateNoteAction(noteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUser();
    const visibility = text(formData, "visibility");
    await notes.updateNote(user, noteId, {
      title: text(formData, "title"),
      body: text(formData, "body"),
      ...(visibility ? { visibility } : {}),
      updatedAt: text(formData, "updatedAt"),
    });
  } catch (err) {
    return failed(err);
  }
  revalidatePath("/notes");
  redirect(`/notes/${noteId}`);
}

export async function deleteNoteAction(noteId: string): Promise<FormState> {
  try {
    await notes.deleteNote(await requireUser(), noteId);
  } catch (err) {
    return failed(err);
  }
  revalidatePath("/notes");
  redirect("/notes");
}

export async function setVisibilityAction(noteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await notes.setVisibility(await requireUser(), noteId, text(formData, "visibility"));
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/notes/${noteId}`);
  return { error: null, message: "Visibility updated." };
}

export async function shareNoteAction(noteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await notes.shareNote(await requireUser(), noteId, {
      email: text(formData, "email"),
      permission: text(formData, "permission") || "read",
    });
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/notes/${noteId}`);
  // Same message whether or not the email belongs to a user.
  return { error: null, message: "If that person has an account, they can now open this note." };
}

export async function revokeShareAction(noteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await notes.revokeShare(await requireUser(), noteId, { userId: text(formData, "userId") });
  } catch (err) {
    return failed(err);
  }
  revalidatePath(`/notes/${noteId}`);
  return { error: null, message: "Access removed." };
}
