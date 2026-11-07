import { requireUser } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { errorResponse, readJson } from "@/lib/http";
import { deleteNote, getNote, listShares, updateNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/notes/:id. The owner also gets the share list. */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const note = await getNote(user, id);
    const shares = note.access === "owner" ? await listShares(user, id) : undefined;
    return Response.json({ note, shares });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/notes/:id. Body: { title?, body?, visibility?, updatedAt } (409 if updatedAt is stale). */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    const { id } = await ctx.params;
    const note = await updateNote(user, id, await readJson(request));
    return Response.json({ note });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/notes/:id (owner, or admin). */
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    const { id } = await ctx.params;
    await deleteNote(user, id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
