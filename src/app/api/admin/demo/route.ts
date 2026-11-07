import { requireRole } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { loadDemoWorkspace, reserveDemoLoad } from "@/lib/demo-workspace";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

/** Bodyless: callers cannot choose CLI credentials or elevate a demo user. */
export async function POST(request: Request) {
  try {
    const actor = await requireRole("admin");
    requireSameOrigin(request);
    await reserveDemoLoad(actor);
    return Response.json(await loadDemoWorkspace(actor));
  } catch (err) {
    return errorResponse(err);
  }
}
