export type SnippetPart = { match: boolean; text: string };

/**
 * Keyword snippets are plain text. The database wraps matches in « ».
 * Split on those markers and render the pieces as text, never as HTML.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const re = /«([^»]*)»/g;
  let last = 0;
  for (const match of snippet.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ match: false, text: snippet.slice(last, index) });
    parts.push({ match: true, text: match[1] ?? "" });
    last = index + match[0].length;
  }
  if (last < snippet.length) parts.push({ match: false, text: snippet.slice(last) });
  if (parts.length === 0) parts.push({ match: false, text: snippet });
  return parts;
}
