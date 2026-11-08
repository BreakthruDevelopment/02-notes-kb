export type AnswerPart = { type: "text"; text: string } | { type: "cite"; n: number };

/**
 * Split an answer into text and citation markers. A marker links only when that
 * source number was actually returned. Everything else stays plain text.
 */
export function answerParts(answer: string, citationCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  for (const match of answer.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", text: answer.slice(last, index) });
    const n = Number(match[1]);
    if (Number.isInteger(n) && n >= 1 && n <= citationCount) parts.push({ type: "cite", n });
    else parts.push({ type: "text", text: match[0] });
    last = index + match[0].length;
  }
  if (last < answer.length) parts.push({ type: "text", text: answer.slice(last) });
  if (parts.length === 0) parts.push({ type: "text", text: answer });
  return parts;
}

/** A refusal lists nothing, even if the answer text mentions a number in brackets. */
export function visibleCitations<T>(found: boolean, citations: T[]): T[] {
  return found ? citations : [];
}
