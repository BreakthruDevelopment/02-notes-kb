import { requireUser } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { errorResponse, readJson } from "@/lib/http";
import { createNote, listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

/** GET /api/notes?tab=mine|shared|workspace&q= */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const notes = await listNotes(user, params.get("tab") ?? "mine", params.get("q"));
    return Response.json({ notes });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/notes. Body: { title, body?, visibility? } */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    const note = await createNote(user, await readJson(request));
    return Response.json({ note }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
