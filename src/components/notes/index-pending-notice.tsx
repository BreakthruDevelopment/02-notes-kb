/** Shown when a saved note has not finished embedding. Keyword search still works. */
export function IndexPendingNotice() {
  return (
    <p role="status" className="mb-4 rounded-card border border-border bg-building-soft px-4 py-3 text-sm text-building">
      Indexing is pending. This note is saved and keyword search can still find it. It joins semantic search after
      indexing finishes.
    </p>
  );
}
