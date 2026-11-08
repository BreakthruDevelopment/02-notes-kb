"use server";

import { formError } from "@/app/actions/form-error";
import type { AskState } from "@/components/ask/state";
import { ask } from "@/lib/ask";
import { requireUser } from "@/lib/auth/session";

function text(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw : "";
}

/** Same ask() the POST /api/ask route calls. The question is not logged. */
export async function askAction(_prev: AskState, formData: FormData): Promise<AskState> {
  try {
    const user = await requireUser();
    const result = await ask(user, { question: text(formData, "question") });
    return { error: null, result };
  } catch (err) {
    return { error: formError(err), result: null };
  }
}
