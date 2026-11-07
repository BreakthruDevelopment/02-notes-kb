import { describe, expect, it } from "vitest";
import { snippetParts } from "./snippet";

describe("snippetParts", () => {
  it("marks « » matches and keeps HTML as text", () => {
    expect(snippetParts("Use <script>alert(1)</script> and «carry» over")).toEqual([
      { match: false, text: "Use <script>alert(1)</script> and " },
      { match: true, text: "carry" },
      { match: false, text: " over" },
    ]);
  });

  it("returns an unmarked snippet unchanged", () => {
    expect(snippetParts("left(body) fallback")).toEqual([{ match: false, text: "left(body) fallback" }]);
  });
});
