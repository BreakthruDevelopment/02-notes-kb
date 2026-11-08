import { describe, expect, it } from "vitest";
import { filterNoteMeta, noteTitle, type NoteMetaRow } from "./meta";

const secret: NoteMetaRow = {
  title: null,
  ownerName: "Cleo",
  ownerEmail: "cleo@demo.breakthru.test",
  visibility: "private",
  indexStatus: "ready",
};

const pto: NoteMetaRow = {
  title: "PTO policy",
  ownerName: "Ada",
  ownerEmail: "ada@demo.breakthru.test",
  visibility: "workspace",
  indexStatus: "pending",
};

describe("noteTitle", () => {
  it("masks a missing title", () => {
    expect(noteTitle(null)).toBe("Private note");
    expect(noteTitle("PTO policy")).toBe("PTO policy");
  });
});

describe("filterNoteMeta", () => {
  const rows = [secret, pto];

  it("does not match the hidden title of a private note", () => {
    expect(filterNoteMeta(rows, { q: "severance plan", visibility: "all", index: "all" })).toEqual([]);
    expect(filterNoteMeta(rows, { q: "cleo", visibility: "all", index: "all" })).toEqual([secret]);
  });

  it("filters by the title an admin is allowed to see", () => {
    expect(filterNoteMeta(rows, { q: "pto", visibility: "all", index: "all" })).toEqual([pto]);
  });

  it("filters by visibility and index status", () => {
    expect(filterNoteMeta(rows, { q: "", visibility: "workspace", index: "pending" })).toEqual([pto]);
    expect(filterNoteMeta(rows, { q: "", visibility: "private", index: "pending" })).toEqual([]);
  });
});
