/**
 * Runs against a real Postgres with pgvector when TEST_DATABASE_URL is set (CI provides one).
 * Proves the note ACL, sharing rules, limits and admin metadata view at the data layer.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("notes data layer (Postgres)", () => {
  let sql: postgres.Sql;
  let n: typeof import("@/lib/notes");
  const owner = { id: "nt-owner", role: "user" as const };
  const bob = { id: "nt-bob", role: "user" as const };
  const cleo = { id: "nt-cleo", role: "user" as const };
  const admin = { id: "nt-admin", role: "admin" as const };
  const emails: Record<string, string> = {
    "nt-owner": "nt-owner@notes-test.local",
    "nt-bob": "Nt-Bob@notes-test.local",
    "nt-cleo": "nt-cleo@notes-test.local",
    "nt-admin": "nt-admin@notes-test.local",
  };

  const mk = (actor: typeof owner, title: string, extra: Record<string, unknown> = {}) =>
    n.createNote(actor, { title, body: `${title} body`, ...extra });

  async function addChunk(noteId: string, content: string, ord = 0) {
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text)
      values (${noteId}, ${ord}, ${content}, ${"h" + ord + noteId}, ${content})`;
  }

  async function wipe() {
    await sql`delete from note where owner_id like 'nt-%'`;
    await sql`delete from rate_event where user_id like 'nt-%'`;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`delete from "user" where id like 'nt-%'`;
    for (const [id, email] of Object.entries(emails)) {
      await sql`insert into "user" (id, name, email, role) values (${id}, ${id}, ${email}, ${id === "nt-admin" ? "admin" : "user"})`;
    }
    n = await import("@/lib/notes");
  });

  beforeEach(wipe);

  afterAll(async () => {
    await wipe();
    await sql`delete from "user" where id like 'nt-%'`;
    await sql.end();
  });

  describe("private notes", () => {
    it("are 404 to other users on get, update, delete, share and list", async () => {
      const note = await mk(owner, "nt-secret");
      await expect(n.getNote(bob, note.id)).rejects.toMatchObject({ status: 404 });
      await expect(n.updateNote(bob, note.id, { title: "x", updatedAt: note.updatedAt.toISOString() })).rejects.toMatchObject({ status: 404 });
      await expect(n.deleteNote(bob, note.id)).rejects.toMatchObject({ status: 404 });
      await expect(n.shareNote(bob, note.id, { email: emails["nt-cleo"], permission: "read" })).rejects.toMatchObject({ status: 404 });
      await expect(n.setVisibility(bob, note.id, "workspace")).rejects.toMatchObject({ status: 404 });
      for (const tab of ["mine", "shared", "workspace"]) {
        expect((await n.listNotes(bob, tab)).map((x) => x.id)).not.toContain(note.id);
      }
      expect(await n.keywordSearch(bob, "secret")).toEqual([]);
    });

    it("are 404 to admin for the body, and admin's list and search skip them", async () => {
      const note = await mk(owner, "nt-adminblind");
      await expect(n.getNote(admin, note.id)).rejects.toMatchObject({ status: 404 });
      await expect(n.updateNote(admin, note.id, { title: "x", updatedAt: note.updatedAt.toISOString() })).rejects.toMatchObject({ status: 404 });
      await expect(n.shareNote(admin, note.id, { email: emails["nt-bob"], permission: "read" })).rejects.toMatchObject({ status: 404 });
      for (const tab of ["mine", "shared", "workspace"]) {
        expect((await n.listNotes(admin, tab)).map((x) => x.id)).not.toContain(note.id);
      }
      expect(await n.keywordSearch(admin, "adminblind")).toEqual([]);
    });

    it("a malformed id is a 404, not a server error", async () => {
      await expect(n.getNote(owner, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
    });

    it("the owner reads, lists and finds them", async () => {
      const note = await mk(owner, "nt-mine");
      expect((await n.getNote(owner, note.id)).access).toBe("owner");
      expect((await n.listNotes(owner, "mine")).map((x) => x.id)).toContain(note.id);
      expect((await n.keywordSearch(owner, "nt-mine")).map((h) => h.noteId)).toContain(note.id);
    });
  });

  describe("workspace notes", () => {
    it("are readable and listed for every user (admin included) but not editable", async () => {
      const note = await mk(owner, "nt-wiki", { visibility: "workspace" });
      for (const actor of [bob, cleo, admin]) {
        expect((await n.getNote(actor, note.id)).access).toBe("read");
        expect((await n.listNotes(actor, "workspace")).map((x) => x.id)).toContain(note.id);
      }
      await expect(
        n.updateNote(bob, note.id, { title: "hacked", updatedAt: note.updatedAt.toISOString() }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(n.deleteNote(bob, note.id)).rejects.toMatchObject({ status: 403 });
    });

    it("making a note workspace-visible opens it, and making it private closes it", async () => {
      const note = await mk(owner, "nt-toggle");
      await n.setVisibility(owner, note.id, "workspace");
      expect((await n.getNote(bob, note.id)).id).toBe(note.id);
      await n.setVisibility(owner, note.id, "private");
      await expect(n.getNote(bob, note.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("shares", () => {
    it("a read share can read and find the note but not edit (403)", async () => {
      const note = await mk(owner, "nt-readshare");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "read" });
      expect((await n.getNote(bob, note.id)).access).toBe("read");
      expect((await n.listNotes(bob, "shared")).map((x) => x.id)).toContain(note.id);
      expect((await n.keywordSearch(bob, "nt-readshare")).map((h) => h.noteId)).toContain(note.id);
      await expect(
        n.updateNote(bob, note.id, { title: "nope", updatedAt: note.updatedAt.toISOString() }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await n.getNote(owner, note.id)).title).toBe("nt-readshare");
    });

    it("an edit share can edit the content but not share, revoke, change visibility or delete", async () => {
      const note = await mk(owner, "nt-editshare");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "edit" });
      const edited = await n.updateNote(bob, note.id, { body: "edited by bob", updatedAt: note.updatedAt.toISOString() });
      expect(edited.body).toBe("edited by bob");
      await expect(n.shareNote(bob, note.id, { email: emails["nt-cleo"], permission: "read" })).rejects.toMatchObject({ status: 403 });
      await expect(n.revokeShare(bob, note.id, { userId: "nt-bob" })).rejects.toMatchObject({ status: 403 });
      await expect(n.setVisibility(bob, note.id, "workspace")).rejects.toMatchObject({ status: 403 });
      await expect(
        n.updateNote(bob, note.id, { visibility: "workspace", updatedAt: edited.updatedAt.toISOString() }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(n.listShares(bob, note.id)).rejects.toMatchObject({ status: 403 });
      await expect(n.deleteNote(bob, note.id)).rejects.toMatchObject({ status: 403 });
      expect((await n.getNote(owner, note.id)).visibility).toBe("private");
    });

    it("revoking takes effect at once for get, list and search", async () => {
      const note = await mk(owner, "nt-revokeme");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "read" });
      await n.getNote(bob, note.id);
      await n.revokeShare(owner, note.id, { userId: "nt-bob" });
      await expect(n.getNote(bob, note.id)).rejects.toMatchObject({ status: 404 });
      expect((await n.listNotes(bob, "shared")).map((x) => x.id)).not.toContain(note.id);
      expect(await n.keywordSearch(bob, "revokeme")).toEqual([]);
    });

    it("matches emails exactly but case-insensitively, and re-sharing upserts the permission", async () => {
      const note = await mk(owner, "nt-upsert");
      await n.shareNote(owner, note.id, { email: "NT-BOB@notes-test.local", permission: "read" });
      expect((await n.getNote(bob, note.id)).access).toBe("read");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "edit" });
      expect((await n.getNote(bob, note.id)).access).toBe("edit");
      const shares = await n.listShares(owner, note.id);
      expect(shares).toHaveLength(1);
      expect(shares[0]).toMatchObject({ userId: "nt-bob", permission: "edit" });
      // A partial email matches nobody.
      await n.shareNote(owner, note.id, { email: "nt-cleo@notes-test.loca", permission: "read" });
      await expect(n.getNote(cleo, note.id)).rejects.toMatchObject({ status: 404 });
    });

    it("gives the identical response for an unknown email and creates no row", async () => {
      const note = await mk(owner, "nt-enum");
      const known = await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "read" });
      const unknown = await n.shareNote(owner, note.id, { email: "nobody-here@notes-test.local", permission: "read" });
      expect(unknown).toEqual(known);
      const rows = await sql`select user_id from note_share where note_id = ${note.id}`;
      expect(rows.map((r) => r.user_id)).toEqual(["nt-bob"]);
    });

    it("refuses to share with yourself", async () => {
      const note = await mk(owner, "nt-self");
      await expect(n.shareNote(owner, note.id, { email: emails["nt-owner"], permission: "read" })).rejects.toMatchObject({ status: 400 });
    });

    it("rejects the 31st attempt in an hour with 429, counting unknown emails", async () => {
      const note = await mk(owner, "nt-ratelimit");
      for (let i = 0; i < 30; i++) {
        const email = i % 2 ? `ghost-${i}@notes-test.local` : emails["nt-bob"];
        await n.shareNote(owner, note.id, { email, permission: "read" });
      }
      await expect(n.shareNote(owner, note.id, { email: emails["nt-cleo"], permission: "read" })).rejects.toMatchObject({ status: 429 });
      await expect(n.shareNote(owner, note.id, { email: "ghost-x@notes-test.local", permission: "read" })).rejects.toMatchObject({ status: 429 });
      await expect(n.getNote(cleo, note.id)).rejects.toMatchObject({ status: 404 });
      // The limit is per user.
      const other = await mk(bob, "nt-other-user");
      await expect(n.shareNote(bob, other.id, { email: emails["nt-cleo"], permission: "read" })).resolves.toEqual({ shared: true });
    });

    it("attempts older than an hour don't count", async () => {
      const note = await mk(owner, "nt-window");
      for (let i = 0; i < 30; i++) {
        await sql`insert into rate_event (user_id, kind, at) values ('nt-owner', 'share', now() - interval '61 minutes')`;
      }
      await expect(n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "read" })).resolves.toEqual({ shared: true });
    });
  });

  describe("optimistic concurrency", () => {
    it("succeeds with the fresh updatedAt and returns a new one", async () => {
      const note = await mk(owner, "nt-fresh");
      const v2 = await n.updateNote(owner, note.id, { title: "nt-fresh 2", updatedAt: note.updatedAt.toISOString() });
      expect(v2.title).toBe("nt-fresh 2");
      expect(v2.updatedAt.getTime()).toBeGreaterThan(note.updatedAt.getTime());
      const v3 = await n.updateNote(owner, note.id, { title: "nt-fresh 3", updatedAt: v2.updatedAt.toISOString() });
      expect(v3.title).toBe("nt-fresh 3");
    });

    it("returns 409 on a stale updatedAt and leaves the note unchanged", async () => {
      const note = await mk(owner, "nt-stale");
      await n.updateNote(owner, note.id, { body: "first writer", updatedAt: note.updatedAt.toISOString() });
      await expect(
        n.updateNote(owner, note.id, { body: "second writer", updatedAt: note.updatedAt.toISOString() }),
      ).rejects.toMatchObject({ status: 409 });
      expect((await n.getNote(owner, note.id)).body).toBe("first writer");
    });

    it("an editor with a stale copy gets 409, and a revoked editor gets 404", async () => {
      const note = await mk(owner, "nt-edstale");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "edit" });
      await n.updateNote(owner, note.id, { body: "owner edit", updatedAt: note.updatedAt.toISOString() });
      await expect(n.updateNote(bob, note.id, { body: "late", updatedAt: note.updatedAt.toISOString() })).rejects.toMatchObject({ status: 409 });
      await n.revokeShare(owner, note.id, { userId: "nt-bob" });
      await expect(n.updateNote(bob, note.id, { body: "late", updatedAt: note.updatedAt.toISOString() })).rejects.toMatchObject({ status: 404 });
    });

    it("content changes mark the note pending; a visibility-only change leaves the index status", async () => {
      const note = await mk(owner, "nt-pending");
      await sql`update note set index_status = 'ready' where id = ${note.id}`;
      const fresh = await n.getNote(owner, note.id);
      const vis = await n.updateNote(owner, note.id, { visibility: "workspace", updatedAt: fresh.updatedAt.toISOString() });
      expect(vis.indexStatus).toBe("ready");
      const body = await n.updateNote(owner, note.id, { body: "changed", updatedAt: vis.updatedAt.toISOString() });
      expect(body.indexStatus).toBe("pending");
    });
  });

  describe("limits and validation", () => {
    it("holds the 100-note cap per user, with a clear message, and only for that user", async () => {
      await sql`insert into note (owner_id, title) select 'nt-owner', 'nt-bulk ' || g from generate_series(1, 100) g`;
      await expect(mk(owner, "nt-101st")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("100") });
      await expect(mk(bob, "nt-bob-first")).resolves.toMatchObject({ title: "nt-bob-first" });
      await n.deleteNote(owner, (await n.listNotes(owner, "mine"))[0].id);
      await expect(mk(owner, "nt-after-delete")).resolves.toBeDefined();
    });

    it("validates input with zod (title, body size, visibility)", async () => {
      await expect(n.createNote(owner, { title: "" })).rejects.toMatchObject({ name: "ZodError" });
      await expect(n.createNote(owner, { title: "x".repeat(201) })).rejects.toMatchObject({ name: "ZodError" });
      await expect(n.createNote(owner, { title: "ok", body: "x".repeat(20_001) })).rejects.toMatchObject({ name: "ZodError" });
      await expect(n.createNote(owner, { title: "ok", visibility: "public" })).rejects.toMatchObject({ name: "ZodError" });
      await expect(n.keywordSearch(owner, "q".repeat(201))).rejects.toMatchObject({ name: "ZodError" });
      const ok = await n.createNote(owner, { title: "x".repeat(200), body: "y".repeat(20_000) });
      expect(ok.body).toHaveLength(20_000);
    });
  });

  describe("admin", () => {
    it("can delete any note, including someone's private note", async () => {
      const note = await mk(owner, "nt-admin-delete");
      await n.deleteNote(admin, note.id);
      expect(await sql`select 1 from note where id = ${note.id}`).toHaveLength(0);
    });

    it("lists metadata for all notes with no body, and a null title for private unshared notes", async () => {
      const priv = await mk(owner, "nt-meta-private");
      const shared = await mk(owner, "nt-meta-shared");
      const ws = await mk(bob, "nt-meta-workspace", { visibility: "workspace" });
      await n.shareNote(owner, shared.id, { email: emails["nt-cleo"], permission: "read" });
      await addChunk(priv.id, "chunk text that must not leak");

      const meta = await n.listAllNoteMeta(admin);
      const byId = new Map(meta.map((m) => [m.id, m]));
      expect(byId.get(priv.id)).toMatchObject({ title: null, ownerId: "nt-owner", visibility: "private", shareCount: 0 });
      expect(byId.get(shared.id)).toMatchObject({ title: "nt-meta-shared", shareCount: 1 });
      expect(byId.get(ws.id)).toMatchObject({ title: "nt-meta-workspace", visibility: "workspace" });
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toContain("nt-meta-private");
      expect(serialized).not.toContain("body");
      expect(serialized).not.toContain("chunk text");
      for (const m of meta) expect(Object.keys(m)).not.toContain("body");
    });

    it("metadata and delete are admin-only: a plain user gets 403 on the list", async () => {
      await expect(n.listAllNoteMeta(owner)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("delete", () => {
    it("cascades chunks and shares, and is owner-only for users", async () => {
      const note = await mk(owner, "nt-cascade");
      await n.shareNote(owner, note.id, { email: emails["nt-bob"], permission: "edit" });
      await addChunk(note.id, "one", 0);
      await addChunk(note.id, "two", 1);
      expect(await sql`select 1 from note_chunk where note_id = ${note.id}`).toHaveLength(2);
      await n.deleteNote(owner, note.id);
      expect(await sql`select 1 from note where id = ${note.id}`).toHaveLength(0);
      expect(await sql`select 1 from note_chunk where note_id = ${note.id}`).toHaveLength(0);
      expect(await sql`select 1 from note_share where note_id = ${note.id}`).toHaveLength(0);
      await expect(n.getNote(bob, note.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("list and keyword search", () => {
    it("filters each tab and by keyword", async () => {
      const mine = await mk(owner, "nt-tab-mine alpha");
      const shared = await mk(bob, "nt-tab-shared beta");
      const ws = await mk(cleo, "nt-tab-ws gamma", { visibility: "workspace" });
      await n.shareNote(bob, shared.id, { email: emails["nt-owner"], permission: "read" });
      const ids = async (tab: string, q?: string) => (await n.listNotes(owner, tab, q)).map((x) => x.id);
      expect(await ids("mine")).toEqual([mine.id]);
      expect(await ids("shared")).toEqual([shared.id]);
      expect(await ids("workspace")).toEqual([ws.id]);
      expect(await ids("mine", "ALPHA")).toEqual([mine.id]);
      expect(await ids("mine", "beta")).toEqual([]);
      // % and _ are literals, not wildcards.
      expect(await ids("mine", "%")).toEqual([]);
    });

    it("full-text search finds chunk content in readable notes only, with a snippet", async () => {
      const mine = await mk(owner, "nt-fts mine");
      const theirs = await mk(bob, "nt-fts theirs");
      await addChunk(mine.id, "The zebracorn deployment procedure is documented here.");
      await addChunk(theirs.id, "Another zebracorn secret that owner must not see.");
      const hits = await n.keywordSearch(owner, "zebracorn");
      expect(hits.map((h) => h.noteId)).toEqual([mine.id]);
      expect(hits[0].snippet).toContain("zebracorn");
      await n.shareNote(bob, theirs.id, { email: emails["nt-owner"], permission: "read" });
      expect((await n.keywordSearch(owner, "zebracorn")).map((h) => h.noteId).sort()).toEqual([mine.id, theirs.id].sort());
    });

    it("falls back to a title match for notes with no chunks, and caps results at 20", async () => {
      await sql`insert into note (owner_id, title) select 'nt-owner', 'nt-fallback ' || g from generate_series(1, 25) g`;
      const hits = await n.keywordSearch(owner, "nt-fallback");
      expect(hits).toHaveLength(20);
      const chunked = await mk(owner, "nt-fallback chunked");
      await addChunk(chunked.id, "completely different words");
      const again = await n.keywordSearch(owner, "nt-fallback chunked");
      // A note that has chunks is found by its content, not by the title fallback.
      expect(again.map((h) => h.noteId)).not.toContain(chunked.id);
    });
  });

  describe("indexing hook", () => {
    it("the default reindexNote hook is a no-op that resolves", async () => {
      const indexing = await import("@/lib/indexing");
      expect(await indexing.reindexNote({} as never)).toBeUndefined();
    });
  });
});
