"use server";

import { revalidatePath } from "next/cache";
import { formError } from "@/app/actions/form-error";
import type { DemoState, ReindexState } from "@/components/admin/state";
import { requireRole } from "@/lib/auth/session";
import { loadDemoWorkspace, reserveDemoLoad } from "@/lib/demo-workspace";
import { reindexPending } from "@/lib/indexing";

/** Same reindexPending() the POST /api/admin/reindex route calls. */
export async function reindexPendingAction(prev: ReindexState): Promise<ReindexState> {
  void prev;
  try {
    await requireRole("admin");
    const result = await reindexPending();
    revalidatePath("/admin");
    return { error: null, processed: result.processed, remaining: result.remaining };
  } catch (err) {
    return { error: formError(err), processed: null, remaining: null };
  }
}

/**
 * Same reserveDemoLoad + loadDemoWorkspace() the POST /api/admin/demo route calls.
 * No form fields: the caller cannot choose CLI mode or a password.
 */
export async function loadDemoWorkspaceAction(prev: DemoState): Promise<DemoState> {
  void prev;
  try {
    const actor = await requireRole("admin");
    await reserveDemoLoad(actor);
    const result = await loadDemoWorkspace(actor);
    revalidatePath("/admin");
    revalidatePath("/notes");
    return {
      error: null,
      message: `Loaded ${result.notes} demo notes for ${result.users} people. ${result.indexed} are indexed.`,
    };
  } catch (err) {
    return { error: formError(err), message: null };
  }
}
