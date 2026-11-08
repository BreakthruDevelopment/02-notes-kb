import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { z } from "zod";
import { LoadDemoControl } from "@/components/admin/load-demo-control";
import { filterNoteMeta, noteTitle } from "@/components/admin/meta";
import { ReindexControl } from "@/components/admin/reindex-control";
import { formatWhen } from "@/components/notes/format";
import { VisibilityBadge } from "@/components/notes/visibility-badge";
import { type Column, DataList, FilterBar, PageIntro, Panel, StatGrid, StatTile, StatusBadge } from "@/components/ui";
import { requireRoleOrRedirect } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { listAllNoteMeta, type NoteMeta } from "@/lib/notes";
import { usageToday } from "@/lib/usage";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const SEARCH_MAX = 100;

function firstParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] ?? "" : value ?? "";
  return raw.trim();
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; visibility?: string | string[]; index?: string | string[] }>;
}) {
  const user = await requireRoleOrRedirect("admin");
  const params = await searchParams;
  const qRaw = firstParam(params.q).slice(0, SEARCH_MAX + 1);
  const queryError = qRaw.length > SEARCH_MAX ? `Search is at most ${SEARCH_MAX} characters.` : null;
  const q = queryError ? "" : qRaw;
  const visibility = z.enum(["private", "workspace"]).safeParse(firstParam(params.visibility)).data;
  const index = z.enum(["ready", "pending"]).safeParse(firstParam(params.index)).data;

  let notes: NoteMeta[] = [];
  let notesError: string | null = null;
  let usage = { ask: 0, embed: 0 };
  let usageError: string | null = null;
  const [listed, counts] = await Promise.allSettled([listAllNoteMeta(user), usageToday()]);
  if (listed.status === "fulfilled") notes = listed.value;
  else {
    log.error("admin.notes_failed", { error: listed.reason instanceof Error ? listed.reason.message : "unknown" });
    notesError = "Notes could not be loaded. Try again in a moment.";
  }
  if (counts.status === "fulfilled") usage = counts.value;
  else {
    log.error("admin.usage_failed", { error: counts.reason instanceof Error ? counts.reason.message : "unknown" });
    usageError = "Usage could not be loaded. Try again in a moment.";
  }

  const filtered = filterNoteMeta(notes, {
    q,
    visibility: visibility ?? "all",
    index: index ?? "all",
  });
  const pending = notes.filter((row) => row.indexStatus === "pending").length;
  const caps = { ask: env().ASK_DAILY_CAP, embed: env().EMBED_DAILY_CHUNKS };

  const users = await db()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
    .limit(100);

  type UserRow = (typeof users)[number];
  const userColumns: Column<UserRow>[] = [
    { key: "name", header: "Name", primary: true, cell: (u) => u.name },
    { key: "email", header: "Email", className: "break-all", cell: (u) => <span className="break-all">{u.email}</span> },
    {
      key: "role",
      header: "Role",
      cell: (u) =>
        u.role === "admin" ? (
          <span className="inline-flex rounded-md bg-accent-soft px-2 py-0.5 text-sm font-medium text-accent">Admin</span>
        ) : (
          "User"
        ),
    },
    {
      key: "joined",
      header: "Joined",
      className: "whitespace-nowrap",
      cell: (u) => u.createdAt.toISOString().slice(0, 10),
    },
  ];

  const noteColumns: Column<NoteMeta>[] = [
    {
      key: "title",
      header: "Title",
      primary: true,
      cell: (row) => (
        <span className={row.title ? "break-words font-semibold" : "text-muted"}>{noteTitle(row.title)}</span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (row) => (
        <span className="break-words">
          {row.ownerName}
          <span className="block break-all text-sm text-muted">{row.ownerEmail}</span>
        </span>
      ),
    },
    {
      key: "visibility",
      header: "Visibility",
      cell: (row) => <VisibilityBadge visibility={row.visibility} />,
    },
    {
      key: "shares",
      header: "Shares",
      cell: (row) => row.shareCount,
    },
    {
      key: "index",
      header: "Index",
      cell: (row) =>
        row.indexStatus === "pending" ? (
          <StatusBadge status="building" label="Indexing pending" />
        ) : (
          <StatusBadge status="live" label="Ready" />
        ),
    },
    {
      key: "updated",
      header: "Updated",
      cell: (row) => formatWhen(row.updatedAt),
    },
  ];

  const emptyNotes = q
    ? `No notes match "${q}".`
    : visibility || index
      ? "No notes match these filters."
      : "No notes yet.";

  return (
    <>
      <PageIntro
        section="Admin"
        title="Admin"
        description="Note metadata, today's AI usage, and the people who have signed up. Private notes with no shares stay masked, and note bodies are not shown."
      />
      <StatGrid>
        <StatTile value={notesError ? "—" : notes.length} label="Notes" tone="accent" />
        <StatTile value={notesError ? "—" : pending} label="Pending index" tone={pending > 0 ? "building" : "default"} />
        <StatTile value={usageError ? "—" : usage.ask} label={`Asks today of ${caps.ask}`} />
        <StatTile value={usageError ? "—" : usage.embed} label={`Embeds today of ${caps.embed}`} />
      </StatGrid>
      {usageError && (
        <p role="alert" className="mb-4 text-sm font-medium text-danger">
          {usageError}
        </p>
      )}
      <Panel title="Tools">
        <div className="space-y-6">
          <ReindexControl />
          <LoadDemoControl />
        </div>
      </Panel>
      <FilterBar
        label="Filter notes"
        search={{ value: qRaw.slice(0, SEARCH_MAX), placeholder: "Filter by title or owner" }}
        filters={[
          {
            name: "visibility",
            label: "Visibility",
            value: visibility ?? "",
            options: [
              { value: "", label: "Any visibility" },
              { value: "private", label: "Private" },
              { value: "workspace", label: "Workspace" },
            ],
          },
          {
            name: "index",
            label: "Index",
            value: index ?? "",
            options: [
              { value: "", label: "Any index status" },
              { value: "ready", label: "Ready" },
              { value: "pending", label: "Indexing pending" },
            ],
          },
        ]}
      />
      {queryError && (
        <p role="alert" className="mb-4 text-sm font-medium text-danger">
          {queryError}
        </p>
      )}
      <Panel title="Notes" count={notesError ? undefined : filtered.length}>
        {notesError ? (
          <p role="alert" className="text-sm text-danger">
            {notesError}
          </p>
        ) : (
          <DataList
            caption="Note metadata"
            rows={filtered}
            rowKey={(row) => row.id}
            columns={noteColumns}
            empty={emptyNotes}
          />
        )}
      </Panel>
      <StatGrid>
        <StatTile value={users.length} label="Users" tone="accent" />
        <StatTile value={users.filter((u) => u.role === "admin").length} label="Admins" />
      </StatGrid>
      <Panel title="All users" count={users.length}>
        <DataList caption="Users" rows={users} rowKey={(u) => u.id} columns={userColumns} empty="No users yet." />
      </Panel>
    </>
  );
}
