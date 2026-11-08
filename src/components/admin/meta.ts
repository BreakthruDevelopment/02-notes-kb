export type NoteMetaRow = {
  title: string | null;
  ownerName: string;
  ownerEmail: string;
  visibility: "private" | "workspace";
  indexStatus: "ready" | "pending";
};

export type MetaFilter = {
  q: string;
  visibility: "all" | "private" | "workspace";
  index: "all" | "ready" | "pending";
};

/** The label shown for a note. A null title is already masked by the server. */
export function noteTitle(title: string | null): string {
  return title ?? "Private note";
}

/**
 * Filter metadata the admin is allowed to see. A null title is not searchable,
 * so a private note's real title cannot be recovered through the box.
 */
export function filterNoteMeta<T extends NoteMetaRow>(rows: T[], filter: MetaFilter): T[] {
  const q = filter.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.visibility !== "all" && row.visibility !== filter.visibility) return false;
    if (filter.index !== "all" && row.indexStatus !== filter.index) return false;
    if (!q) return true;
    const haystack = [row.title ?? "", row.ownerName, row.ownerEmail].join("\n").toLowerCase();
    return haystack.includes(q);
  });
}
