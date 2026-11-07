import { z } from "zod";

export const TITLE_MAX = 200;
export const BODY_MAX = 20_000;
export const MAX_NOTES_PER_USER = 100;
export const SHARES_PER_HOUR = 30;
export const SEARCH_Q_MAX = 200;
export const SEARCH_LIMIT = 20;

export const visibilitySchema = z.enum(["private", "workspace"]);
export const permissionSchema = z.enum(["read", "edit"]);
export const tabSchema = z.enum(["mine", "shared", "workspace"]);

const title = z.string().trim().min(1, "Title is required").max(TITLE_MAX, `Title is at most ${TITLE_MAX} characters`);
const body = z.string().max(BODY_MAX, `Body is at most ${BODY_MAX} characters`);

export const noteIdSchema = z.uuid();

export const createNoteSchema = z.object({
  title,
  body: body.default(""),
  visibility: visibilitySchema.default("private"),
});

/** `updatedAt` is the value the client loaded; the update only applies if it still matches. */
export const updateNoteSchema = z
  .object({
    title: title.optional(),
    body: body.optional(),
    visibility: visibilitySchema.optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined || v.visibility !== undefined, {
    message: "Nothing to change",
  });

export const shareSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  permission: permissionSchema,
});

export const revokeSchema = z.object({ userId: z.string().min(1).max(200) });

export const listQuerySchema = z.object({
  tab: tabSchema.default("mine"),
  q: z.string().trim().max(SEARCH_Q_MAX).optional(),
});

export const searchSchema = z.object({ q: z.string().trim().min(1, "Enter something to search for").max(SEARCH_Q_MAX) });

export type CreateNoteInput = z.input<typeof createNoteSchema>;
export type UpdateNoteInput = z.input<typeof updateNoteSchema>;
export type ShareInput = z.input<typeof shareSchema>;
