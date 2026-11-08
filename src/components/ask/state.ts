/** Matches `QUESTION_MAX` in `src/lib/ask.ts`. The server rejects anything longer. */
export const QUESTION_LIMIT = 500;

export type AskMode = "vector" | "keyword" | "demo";

export type AskCitation = { noteId: string; title: string };

export type AskView = {
  found: boolean;
  answer: string;
  citations: AskCitation[];
  mode: AskMode;
};

export type AskState = { error: string | null; result: AskView | null };

export const emptyAskState: AskState = { error: null, result: null };
