/**
 * A small Markdown subset for notes.
 * Raw HTML is kept as text. Links are allowlisted (http, https, mailto, same-site paths)
 * so javascript: and data: URLs render as inert text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string }
  | { type: "quote"; children: Block[] };

const MAX_INLINE_DEPTH = 12;
const MAX_BLOCK_DEPTH = 8;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.length > 2048) return null;
  if (/[\u0000-\u001F\u007F]/.test(href)) return null;

  const compact = href.replace(/\s+/g, "").toLowerCase();
  if (
    compact.startsWith("javascript:") ||
    compact.startsWith("data:") ||
    compact.startsWith("vbscript:")
  ) {
    return null;
  }

  if (href.startsWith("#") || href.startsWith("?")) return href;
  if (href.startsWith("/")) {
    if (href.startsWith("//") || href.includes("\\")) return null;
    return href;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") return url.href;
  return null;
}

function isWord(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

function readLink(
  input: string,
  start: number,
  inlineDepth: number,
): { node: Inline; next: number } | null {
  if (input[start] !== "[") return null;
  const close = input.indexOf("]", start + 1);
  if (close === -1 || input[close + 1] !== "(") return null;
  // Destinations may contain balanced parentheses, as in javascript:alert(1).
  let paren = 1;
  let j = close + 2;
  while (j < input.length && paren > 0) {
    const ch = input[j];
    if (ch === "\n" || ch === "\r") return null;
    if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    if (paren === 0) break;
    j += 1;
  }
  if (paren !== 0) return null;
  const url = input.slice(close + 2, j);
  const label = input.slice(start + 1, close);
  const next = j + 1;
  const href = safeHref(url);
  if (!href) return { node: { type: "text", text: label }, next };
  return { node: { type: "link", href, children: parseInline(label, inlineDepth + 1) }, next };
}

function marker0IsUnderscoreInWord(input: string, i: number): boolean {
  return input[i] === "_" && isWord(input[i - 1]);
}

function parseInline(input: string, depth = 0): Inline[] {
  if (depth > MAX_INLINE_DEPTH) return [{ type: "text", text: input }];
  const nodes: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      nodes.push({ type: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);

    if (rest.startsWith("`")) {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        flush();
        nodes.push({ type: "code", text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // A run of underscores inside a word (my__var, x__init__) is literal text, like a single "_".
    if (marker0IsUnderscoreInWord(input, i)) {
      let j = i;
      while (input[j] === "_") j++;
      buf += input.slice(i, j);
      i = j;
      continue;
    }

    if (rest.startsWith("**") || rest.startsWith("__")) {
      const marker = rest.slice(0, 2);
      const end = input.indexOf(marker, i + 2);
      if (end !== -1) {
        flush();
        nodes.push({ type: "strong", children: parseInline(input.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }

    const marker = rest[0];
    const underscoreInsideWord = marker === "_" && isWord(input[i - 1]);
    if (
      !underscoreInsideWord &&
      ((marker === "*" && !rest.startsWith("**")) || (marker === "_" && !rest.startsWith("__"))) &&
      rest[1] &&
      rest[1] !== " "
    ) {
      const end = input.indexOf(marker, i + 1);
      if (end > i + 1 && input[end - 1] !== " ") {
        flush();
        nodes.push({ type: "em", children: parseInline(input.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }

    if (rest.startsWith("![")) {
      const parsed = readLink(input, i + 1, depth);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        i = parsed.next;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const parsed = readLink(input, i, depth);
      if (parsed) {
        flush();
        nodes.push(parsed.node);
        i = parsed.next;
        continue;
      }
    }

    buf += input[i];
    i += 1;
  }
  flush();
  return nodes;
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isListItem(line: string): boolean {
  return /^(\s*)([-*]|\d+\.)\s+/.test(line);
}

function listOrdered(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

export function parseMarkdown(source: string, depth = 0): Block[] {
  if (depth > MAX_BLOCK_DEPTH) return [{ type: "paragraph", children: [{ type: "text", text: source }] }];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(buf.join("\n"), depth + 1) });
      continue;
    }

    if (isListItem(line)) {
      const ordered = listOrdered(line);
      const items: Inline[][] = [];
      while (i < lines.length && isListItem(lines[i]) && listOrdered(lines[i]) === ordered) {
        const text = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        items.push(parseInline(text));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isFence(lines[i]) && !/^(#{1,6})\s+/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !isListItem(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(buf.join(" ")) });
  }

  return blocks;
}
