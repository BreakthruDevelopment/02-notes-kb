import { describe, expect, it } from "vitest";
import { canEditNote, canManageNote, canReadNote, noteAccess } from "@/lib/acl";

const owner = { id: "o", role: "user" as const };
const other = { id: "x", role: "user" as const };
const admin = { id: "a", role: "admin" as const };
const priv = { ownerId: "o", visibility: "private" as const };
const ws = { ownerId: "o", visibility: "workspace" as const };

describe("note policy", () => {
  it("private notes are readable by the owner and grantees only, admin included", () => {
    expect(canReadNote(owner, priv, null)).toBe(true);
    expect(canReadNote(other, priv, null)).toBe(false);
    expect(canReadNote(admin, priv, null)).toBe(false);
    expect(canReadNote(other, priv, "read")).toBe(true);
  });
  it("workspace notes are readable, not editable", () => {
    expect(noteAccess(other, ws, null)).toBe("read");
    expect(canEditNote(other, ws, null)).toBe(false);
  });
  it("edit needs ownership or an edit share", () => {
    expect(canEditNote(other, priv, "read")).toBe(false);
    expect(canEditNote(other, priv, "edit")).toBe(true);
    expect(canEditNote(owner, priv, null)).toBe(true);
  });
  it("manage is the owner's; admin may only delete", () => {
    expect(canManageNote(owner, priv)).toBe(true);
    expect(canManageNote(other, priv, "delete")).toBe(false);
    expect(canManageNote(admin, priv)).toBe(false);
    expect(canManageNote(admin, priv, "delete")).toBe(true);
    expect(canManageNote(other, priv)).toBe(false);
  });
});
