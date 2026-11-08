import { describe, expect, it } from "vitest";
import { CHUNK_MAX, CHUNK_OVERLAP, chunkMarkdown, searchText } from "./chunker";
import { BODY_MAX } from "./notes-schemas";

const para = (word: string, len: number) => (word + " ").repeat(Math.ceil(len / (word.length + 1))).slice(0, len).trim();

describe("chunkMarkdown", () => {
  it("gives an empty body one empty chunk, so the title is still indexed", () => {
    expect(chunkMarkdown("")).toEqual([""]);
    expect(chunkMarkdown("  \n\n \n")).toEqual([""]);
  });

  it("keeps a short note in one chunk", () => {
    expect(chunkMarkdown("# PTO\n\nFive days carry over.\n\nAsk HR.")).toEqual(["# PTO\n\nFive days carry over.\n\nAsk HR."]);
  });

  it("packs paragraphs up to the limit and never exceeds it", () => {
    const body = Array.from({ length: 10 }, (_, i) => para(`p${i}`, 500)).join("\n\n");
    const chunks = chunkMarkdown(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX);
    expect(chunks.join("\n\n")).toBe(body);
  });

  it("starts a new chunk at a heading once the current chunk is reasonably full", () => {
    const chunks = chunkMarkdown(`${para("a", 700)}\n\n## Next\n\n${para("b", 300)}`);
    expect(chunks).toHaveLength(2);
    expect(chunks[1].startsWith("## Next")).toBe(true);
  });

  it("merges small sections instead of making a chunk per heading", () => {
    const body = Array.from({ length: 8 }, (_, i) => `## S${i}\n\nshort text ${i}`).join("\n\n");
    expect(chunkMarkdown(body)).toHaveLength(1);
  });

  it("splits one over-long paragraph with overlap, on word boundaries", () => {
    const words = Array.from({ length: 900 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkMarkdown(words);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX);
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-CHUNK_OVERLAP);
      const firstWord = chunks[i].split(" ")[0];
      expect(tail).toContain(firstWord); // the next chunk starts inside the previous one's last 150 chars
      expect(chunks[i - 1].endsWith(chunks[i].split(" ")[0])).toBe(false);
    }
    // No text is lost: every word appears in some chunk.
    const all = new Set(chunks.flatMap((c) => c.split(" ")));
    for (let i = 0; i < 900; i++) expect(all.has(`w${i}`)).toBe(true);
  });

  it("splits text with no whitespace without looping forever", () => {
    const chunks = chunkMarkdown("x".repeat(5000));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
  });

  it("changing one paragraph changes only its own chunk", () => {
    const paras = [para("alpha", 800), para("beta", 800), para("gamma", 800)];
    const before = chunkMarkdown(paras.join("\n\n"));
    const after = chunkMarkdown([paras[0], para("changed", 800), paras[2]].join("\n\n"));
    expect(before).toHaveLength(3);
    expect(after.filter((c, i) => c !== before[i])).toHaveLength(1);
  });

  it("keeps a maximum-size note to a sane number of chunks", () => {
    const body = Array.from({ length: 30 }, (_, i) => para(`n${i}`, 700)).join("\n\n").slice(0, BODY_MAX);
    expect(chunkMarkdown(body).length).toBeLessThanOrEqual(40);
    expect(chunkMarkdown(para("z", BODY_MAX)).length).toBeLessThanOrEqual(25);
  });

  it("normalizes Windows line endings", () => {
    expect(chunkMarkdown("a\r\n\r\nb")).toEqual(["a\n\nb"]);
  });
});

describe("searchText", () => {
  it("is the title, a newline, then the content, and fits the column limit", () => {
    expect(searchText("T", "c")).toBe("T\nc");
    expect(searchText("t".repeat(200), "c".repeat(CHUNK_MAX)).length).toBeLessThanOrEqual(1710);
  });
});
