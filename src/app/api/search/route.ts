import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http";
import { keywordSearch } from "@/lib/notes";

export const dynamic = "force-dynamic";

/** GET /api/search?q= : keyword search over notes the caller can read, 20 results. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const results = await keywordSearch(user, new URL(request.url).searchParams.get("q") ?? "");
    return Response.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
