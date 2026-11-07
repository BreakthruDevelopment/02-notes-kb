import { requireUser } from "@/lib/auth/session";
import { requireSameOrigin } from "@/lib/csrf";
import { errorResponse, readJson } from "@/lib/http";
import { revokeShare, shareNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/notes/:id/shares (owner). Body: { email, permission }. Same response for unknown emails. */
export async function PUT(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    const { id } = await ctx.params;
    return Response.json(await shareNote(user, id, await readJson(request)));
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/notes/:id/shares (owner). Body: { userId } */
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requireSameOrigin(request);
    const { id } = await ctx.params;
    await revokeShare(user, id, await readJson(request));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
