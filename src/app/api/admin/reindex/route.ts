import { requireRole } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { errorResponse } from "@/lib/http";
import { reindexPending } from "@/lib/indexing";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

/** POST /api/admin/reindex: embed pending notes in small batches within the time budget. Returns { processed, remaining }. */
export async function POST(request: Request) {
  try {
    await requireRole("admin");
    requireSameOrigin(request);
    return Response.json(await reindexPending());
  } catch (err) {
    return errorResponse(err);
  }
}
