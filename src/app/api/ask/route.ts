import { ask } from "@/lib/ask";
import { requireUser } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { errorResponse, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

/** POST /api/ask. Body: { question } (at most 500 characters). Answers only from notes the caller can read. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    // A question is at most 500 characters; 4 KB leaves room for JSON escaping and nothing more.
    const result = await ask(user, await readJson(request, 4 * 1024));
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
