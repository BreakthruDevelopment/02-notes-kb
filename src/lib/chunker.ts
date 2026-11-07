/**
 * Split a Markdown note body into chunks for embedding.
 *
 * Rules (spec: AI feature, Indexing): paragraphs are the unit, a heading starts a new chunk once the current one is
 * reasonably full, chunks are at most CHUNK_MAX characters, and only a paragraph too long for one chunk is split
 * (at whitespace, with CHUNK_OVERLAP characters repeated). Plain paragraph boundaries get no overlap on purpose:
 * editing one paragraph then changes one chunk, not its neighbour, so only that chunk is re-embedded.
 */
export const CHUNK_MAX = 1200;
export const CHUNK_OVERLAP = 150;
/**
 * A heading starts a new chunk only when the current chunk already has at least this much text. Below it the
 * heading and its text join the previous chunk: a note with many short sections would otherwise become dozens of
 * tiny chunks (more embedding calls, more noise in the top 6), and a short chunk carries too little context to
 * match a question. 600 is half of CHUNK_MAX, so a section boundary is honored whenever a chunk is at least half full.
 */
const HEADING_FLUSH_MIN = 600;
const SEPARATOR = "\n\n";

const HEADING = /^\s{0,3}#{1,6}\s/;

/** Split one over-long paragraph into pieces of at most CHUNK_MAX, each overlapping the last by about CHUNK_OVERLAP. */
function hardSplit(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_MAX, text.length);
    if (end < text.length) {
      // Prefer a break at whitespace in the last quarter of the window.
      const floor = start + Math.floor(CHUNK_MAX * 0.75);
      const ws = Math.max(text.lastIndexOf(" ", end), text.lastIndexOf("\n", end));
      if (ws > floor) end = ws;
    }
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= text.length) break;
    let next = end - CHUNK_OVERLAP;
    // Start the overlap on a word boundary, and always make progress.
    const sp = text.indexOf(" ", next);
    if (sp !== -1 && sp < end) next = sp + 1;
    start = Math.max(next, start + 1);
  }
  return pieces;
}

export function chunkMarkdown(body: string): string[] {
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const p of paragraphs) {
    if (p.length > CHUNK_MAX) {
      flush();
      chunks.push(...hardSplit(p));
      continue;
    }
    if (HEADING.test(p) && current.length >= HEADING_FLUSH_MIN) flush();
    if (current && current.length + SEPARATOR.length + p.length > CHUNK_MAX) flush();
    current = current ? current + SEPARATOR + p : p;
  }
  flush();
  // A note with no body is still findable by its title.
  return chunks.length > 0 ? chunks : [""];
}

/** What gets embedded and full-text indexed for a chunk: the title gives short chunks their context. */
export function searchText(title: string, content: string): string {
  return `${title}\n${content}`;
}
