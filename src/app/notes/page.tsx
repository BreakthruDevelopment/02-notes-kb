import type { Metadata } from "next";
import Link from "next/link";
import { SearchSnippet } from "@/components/notes/search-snippet";
import { VisibilityBadge } from "@/components/notes/visibility-badge";
import { formatWhen } from "@/components/notes/format";
import { type Column, DataList, FilterBar, PageIntro, Panel, StatusBadge, buttonPrimary } from "@/components/ui";
import { requireUserOrRedirect } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { keywordSearch, listNotes, type NoteListItem } from "@/lib/notes";
import { SEARCH_Q_MAX, tabSchema } from "@/lib/notes-schemas";

export const metadata: Metadata = { title: "Notes" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "mine", label: "Mine" },
  { id: "shared", label: "Shared with me" },
  { id: "workspace", label: "Workspace" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return raw.trim();
}

function tabHref(tab: TabId, q: string): string {
  const params = new URLSearchParams({ tab });
  if (q) params.set("q", q);
  return `/notes?${params.toString()}`;
}

function emptyCopy(tab: TabId, q: string) {
  if (q) return `No notes match "${q}".`;
  if (tab === "shared") return "No notes have been shared with you.";
  if (tab === "workspace") return "No workspace notes yet.";
  return "You have no notes yet.";
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; q?: string | string[] }>;
}) {
  const user = await requireUserOrRedirect();
  const params = await searchParams;
  const tabParse = tabSchema.safeParse(firstParam(params.tab) || "mine");
  const tab: TabId = tabParse.success ? tabParse.data : "mine";
  const qRaw = firstParam(params.q).slice(0, SEARCH_Q_MAX + 1);
  const queryError = qRaw.length > SEARCH_Q_MAX ? `Search is at most ${SEARCH_Q_MAX} characters.` : null;
  const q = queryError ? "" : qRaw;

  let rows: NoteListItem[] = [];
  let snippets = new Map<string, string>();
  let loadError: string | null = null;
  try {
    const [listed, hits] = await Promise.all([
      listNotes(user, tab, q || undefined),
      q
        ? keywordSearch(user, q).catch((err: unknown) => {
            log.warn("notes.search_snippets_failed", { error: err instanceof Error ? err.message : "unknown" });
            return [];
          })
        : Promise.resolve([]),
    ]);
    rows = listed;
    snippets = new Map(hits.map((hit) => [hit.noteId, hit.snippet]));
  } catch (err) {
    log.error("notes.list_failed", { error: err instanceof Error ? err.message : "unknown" });
    loadError = "Notes could not be loaded. Try again in a moment.";
  }

  const tabTitle = TABS.find((item) => item.id === tab)?.label ?? "Mine";
  const columns: Column<NoteListItem>[] = [
    {
      key: "title",
      header: "Title",
      primary: true,
      cell: (row) => (
        <Link
          href={`/notes/${row.id}`}
          className="inline-flex min-h-11 items-center break-words font-semibold text-accent hover:underline"
        >
          {row.title}
        </Link>
      ),
    },
  ];
  if (q) {
    columns.push({
      key: "match",
      header: "Match",
      cell: (row) => {
        const snippet = snippets.get(row.id);
        return snippet ? <SearchSnippet text={snippet} /> : null;
      },
    });
  }
  columns.push(
    {
      key: "visibility",
      header: "Visibility",
      cell: (row) => (
        <div className="space-y-1">
          <VisibilityBadge visibility={row.visibility} />
          {row.access === "edit" && <p className="text-sm text-muted">Can edit</p>}
          {row.access === "read" && <p className="text-sm text-muted">Can read</p>}
        </div>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (row) => <span className="break-words">{row.ownerName}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      cell: (row) => formatWhen(row.updatedAt),
    },
  );
  if (rows.some((row) => row.indexStatus === "pending")) {
    columns.push({
      key: "index",
      header: "Index",
      cell: (row) =>
        row.indexStatus === "pending" ? (
          <StatusBadge status="building" label="Indexing pending" />
        ) : (
          <span className="text-muted">Ready</span>
        ),
    });
  }

  return (
    <>
      <PageIntro
        section="Notes"
        title="Notes"
        description="Your notes, notes shared with you, and workspace notes."
        actions={
          <Link href="/notes/new" className={buttonPrimary}>
            New note
          </Link>
        }
      />
      <nav aria-label="Note lists" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={tabHref(item.id, q)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-card border px-3 text-sm font-semibold ${
                active
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <FilterBar
        label="Filter notes"
        search={{ value: qRaw, placeholder: "Filter by keyword" }}
        hidden={{ tab }}
      />
      {queryError && (
        <p role="alert" className="mb-4 text-sm font-medium text-danger">
          {queryError}
        </p>
      )}
      <Panel title={tabTitle} count={loadError ? undefined : rows.length}>
        {loadError ? (
          <p role="alert" className="text-sm text-danger">
            {loadError}
          </p>
        ) : (
          <DataList
            caption={`${tabTitle} notes`}
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            empty={
              tab === "mine" && !q ? (
                <p>
                  You have no notes yet.{" "}
                  <Link href="/notes/new" className="font-semibold text-accent underline">
                    Write one
                  </Link>
                  .
                </p>
              ) : (
                emptyCopy(tab, q)
              )
            }
          />
        )}
      </Panel>
    </>
  );
}
