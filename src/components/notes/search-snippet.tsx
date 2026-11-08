import { snippetParts } from "./snippet";

/** Plain-text search snippet. « » mark matches; the string is never interpreted as HTML. */
export function SearchSnippet({ text }: { text: string }) {
  return (
    <p className="break-words text-sm text-muted">
      {snippetParts(text).map((part, index) =>
        part.match ? (
          <mark key={index} className="bg-accent-soft text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
