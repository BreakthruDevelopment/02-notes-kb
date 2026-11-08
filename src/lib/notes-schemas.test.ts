import { describe, expect, it } from "vitest";
import {
  BODY_MAX,
  TITLE_MAX,
  createNoteSchema,
  listQuerySchema,
  noteIdSchema,
  revokeSchema,
  searchSchema,
  shareSchema,
  updateNoteSchema,
} from "@/lib/notes-schemas";

describe("createNoteSchema", () => {
  it("defaults body and visibility and trims the title", () => {
    expect(createNoteSchema.parse({ title: "  Runbook  " })).toEqual({ title: "Runbook", body: "", visibility: "private" });
  });
  it("rejects an empty or too-long title", () => {
    expect(createNoteSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createNoteSchema.safeParse({ title: "x".repeat(TITLE_MAX) }).success).toBe(true);
    expect(createNoteSchema.safeParse({ title: "x".repeat(TITLE_MAX + 1) }).success).toBe(false);
  });
  it("caps the body at 20,000 characters", () => {
    expect(createNoteSchema.safeParse({ title: "a", body: "x".repeat(BODY_MAX) }).success).toBe(true);
    expect(createNoteSchema.safeParse({ title: "a", body: "x".repeat(BODY_MAX + 1) }).success).toBe(false);
  });
  it("rejects unknown visibility values", () => {
    expect(createNoteSchema.safeParse({ title: "a", visibility: "public" }).success).toBe(false);
  });
});

describe("updateNoteSchema", () => {
  const at = "2026-11-07T10:00:00.123Z";
  it("needs updatedAt and at least one change", () => {
    expect(updateNoteSchema.safeParse({ title: "a" }).success).toBe(false);
    expect(updateNoteSchema.safeParse({ updatedAt: at }).success).toBe(false);
    expect(updateNoteSchema.safeParse({ title: "a", updatedAt: at }).success).toBe(true);
    expect(updateNoteSchema.safeParse({ visibility: "workspace", updatedAt: at }).success).toBe(true);
  });
  it("rejects a malformed updatedAt", () => {
    expect(updateNoteSchema.safeParse({ title: "a", updatedAt: "yesterday" }).success).toBe(false);
  });
});

describe("shareSchema", () => {
  it("accepts an email with read or edit", () => {
    expect(shareSchema.parse({ email: " Ben@Example.com ", permission: "edit" })).toEqual({
      email: "Ben@Example.com",
      permission: "edit",
    });
  });
  it("rejects bad emails and permissions", () => {
    expect(shareSchema.safeParse({ email: "not-an-email", permission: "read" }).success).toBe(false);
    expect(shareSchema.safeParse({ email: "a@b.co", permission: "owner" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("noteIdSchema wants a uuid", () => {
    expect(noteIdSchema.safeParse("nope").success).toBe(false);
    expect(noteIdSchema.safeParse("5f0c1c6e-6a4a-4b7e-8f3e-0c2f5b1f1a11").success).toBe(true);
  });
  it("searchSchema needs 1 to 200 characters", () => {
    expect(searchSchema.safeParse({ q: " " }).success).toBe(false);
    expect(searchSchema.safeParse({ q: "x".repeat(200) }).success).toBe(true);
    expect(searchSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
  it("listQuerySchema defaults to the mine tab and rejects unknown tabs", () => {
    expect(listQuerySchema.parse({}).tab).toBe("mine");
    expect(listQuerySchema.safeParse({ tab: "everything" }).success).toBe(false);
  });
  it("revokeSchema needs a userId", () => {
    expect(revokeSchema.safeParse({}).success).toBe(false);
    expect(revokeSchema.safeParse({ userId: "u1" }).success).toBe(true);
  });
});
