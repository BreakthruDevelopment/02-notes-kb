import { describe, expect, it } from "vitest";
import { answerParts, visibleCitations } from "./answer";

describe("answerParts", () => {
  it("links markers that match a returned source", () => {
    expect(answerParts("Carry over is 5 days [1]. See also [2].", 2)).toEqual([
      { type: "text", text: "Carry over is 5 days " },
      { type: "cite", n: 1 },
      { type: "text", text: ". See also " },
      { type: "cite", n: 2 },
      { type: "text", text: "." },
    ]);
  });

  it("leaves unknown markers as text", () => {
    expect(answerParts("Nothing about [9] or [S1].", 1)).toEqual([
      { type: "text", text: "Nothing about " },
      { type: "text", text: "[9]" },
      { type: "text", text: " or [S1]." },
    ]);
  });

  it("does not link markers when there are no citations", () => {
    const parts = answerParts("None of the notes you can read cover this. [1]", 0);
    expect(parts.some((part) => part.type === "cite")).toBe(false);
  });
});

describe("visibleCitations", () => {
  it("hides sources on a refusal", () => {
    expect(visibleCitations(false, [{ noteId: "n", title: "Secret" }])).toEqual([]);
  });

  it("keeps sources when an answer was found", () => {
    const sources = [{ noteId: "n", title: "PTO policy" }];
    expect(visibleCitations(true, sources)).toEqual(sources);
  });
});
