/**
 * Indexing, ACL-filtered retrieval and cited answers against a real Postgres with pgvector
 * (TEST_DATABASE_URL; CI provides one). Demo embeddings and the demo generate fixture: no network.
 */
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/ai", async (orig) => {
  const real = await orig<typeof import("@/lib/ai")>();
  return { ...real, embed: vi.fn(real.embed) };
});

const url = process.env.TEST_DATABASE_URL;
const DAILY = 10;

describe.skipIf(!url)("RAG indexing and retrieval (Postgres + pgvector)", () => {
  let sql: postgres.Sql;
  let n: typeof import("@/lib/notes");
  let ask: typeof import("@/lib/ask");
  let idx: typeof import("@/lib/indexing");
  let ret: typeof import("@/lib/retrieval");
  let embedMod: typeof import("@/lib/ai/embed");
  let embedSpy: Mock;
  const ada = { id: "rg-ada", role: "admin" as const };
  const ben = { id: "rg-ben", role: "user" as const };
  const cleo = { id: "rg-cleo", role: "user" as const };
  const emails: Record<string, string> = { "rg-ada": "rg-ada@rag.local", "rg-ben": "rg-ben@rag.local", "rg-cleo": "rg-cleo@rag.local" };

  const para = (word: string, len = 700) => (word + " ").repeat(Math.ceil(len / (word.length + 1))).slice(0, len).trim();
  const texts = () => embedSpy.mock.calls.flatMap((c) => (c[0] as { texts: string[] }).texts);

  const setUsage = (kind: "embed" | "ask", count: number) =>
    sql`insert into ai_usage (day, kind, count) values ((now() at time zone 'utc')::date, ${kind}, ${count})
      on conflict (day, kind) do update set count = ${count}`;

  const wipe = async () => {
    await sql`delete from note where owner_id like 'rg-%'`;
    await sql`delete from ask_event where user_id like 'rg-%'`;
    await sql`delete from ai_usage`;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.BETTER_AUTH_SECRET ??= "x".repeat(32);
    process.env.AI_PROVIDER = "demo";
    process.env.LOG_LEVEL = "error";
    process.env.EMBED_DAILY_CHUNKS = String(DAILY);
    delete process.env.GEMINI_API_KEY;
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    await sql`delete from "user" where id like 'rg-%'`;
    for (const [id, email] of Object.entries(emails)) {
      await sql`insert into "user" (id, name, email, role) values (${id}, ${id}, ${email}, ${id === "rg-ada" ? "admin" : "user"})`;
    }
    n = await import("@/lib/notes");
    ask = await import("@/lib/ask");
    idx = await import("@/lib/indexing");
    ret = await import("@/lib/retrieval");
    embedMod = await import("@/lib/ai/embed");
    embedSpy = (await import("@/lib/ai")).embed as unknown as Mock;
    const [{ extversion }] = await sql`select extversion from pg_extension where extname = 'vector'`;
    process.stderr.write(`pgvector ${extversion}, iterative scan used: ${await ret.supportsIterativeScan()}\n`);
  });

  beforeEach(async () => {
    await wipe();
    embedSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await wipe();
    await sql`delete from "user" where id like 'rg-%'`;
    await sql.end();
  });

  describe("ACL in retrieval", () => {
    it("never returns another user's private chunk, even with a vector identical to the query", async () => {
      const secret = await n.createNote(cleo, { title: "Cleo private", body: "Quarterly layoffs list for the Zephyr team." });
      const question = "Who is on the layoffs list?";
      const q = embedMod.demoVector(question);
      // Make the private chunk an exact match for the query (distance 0).
      await sql`update note_chunk set embedding = ${JSON.stringify(q)}::vector, embedding_model = ${embedMod.DEMO_EMBED_MODEL} where note_id = ${secret.id}`;
      // Fill the neighbourhood with workspace chunks so a post-filter would have something to return.
      for (let i = 0; i < 8; i++) await n.createNote(ada, { title: `Filler ${i}`, visibility: "workspace", body: `layoffs list filler ${i}` });

      expect((await ret.retrieveChunks(ben.id, q, embedMod.DEMO_EMBED_MODEL)).map((h) => h.noteId)).not.toContain(secret.id);
      expect((await ret.retrieveChunks(ada.id, q, embedMod.DEMO_EMBED_MODEL)).map((h) => h.noteId)).not.toContain(secret.id); // admin is no bypass
      const own = await ret.retrieveChunks(cleo.id, q, embedMod.DEMO_EMBED_MODEL);
      expect(own[0].noteId).toBe(secret.id);

      const r = await ask.ask(ben, { question });
      expect(JSON.stringify(r)).not.toContain(secret.id);
      expect(JSON.stringify(r)).not.toContain("Cleo private");
    });

    it("only compares vectors from the same embedding model", async () => {
      const w = await n.createNote(ada, { title: "Model check", visibility: "workspace", body: "Model check unique words zebra." });
      const q = embedMod.demoVector("Model check\nModel check unique words zebra.");
      expect(await ret.retrieveChunks(ben.id, q, embedMod.DEMO_EMBED_MODEL)).toHaveLength(1);
      expect(await ret.retrieveChunks(ben.id, q, "gemini-embedding-2")).toHaveLength(0);
      await sql`update note_chunk set embedding_model = 'gemini-embedding-2' where note_id = ${w.id}`;
      expect(await ret.retrieveChunks(ben.id, q, embedMod.DEMO_EMBED_MODEL)).toHaveLength(0);
    });

    it("returns at most 6 chunks, nearest first, within the distance cut", async () => {
      for (let i = 0; i < 9; i++) await n.createNote(ada, { title: `Walrus ${i}`, visibility: "workspace", body: `walrus fact ${"walrus ".repeat(i)}` });
      await n.createNote(ada, { title: "Unrelated", visibility: "workspace", body: "completely different vocabulary here" });
      const hits = await ret.retrieveChunks(ben.id, embedMod.demoVector("walrus fact"), embedMod.DEMO_EMBED_MODEL);
      expect(hits).toHaveLength(6);
      expect(hits.some((h) => h.title === "Unrelated")).toBe(false);
    });
  });

  describe("indexing", () => {
    it("a second save with one changed paragraph embeds exactly one chunk", async () => {
      const paras = [para("alpha"), para("beta"), para("gamma")];
      const created = await n.createNote(ada, { title: "Three paragraphs", body: paras.join("\n\n") });
      expect(texts()).toHaveLength(3);
      expect(embedSpy).toHaveBeenCalledTimes(1); // one batch for three chunks
      expect(created.indexStatus).toBe("pending"); // the returned row predates indexing
      const [{ index_status }] = await sql`select index_status from note where id = ${created.id}`;
      expect(index_status).toBe("ready");

      embedSpy.mockClear();
      await n.updateNote(ada, created.id, { body: [paras[0], para("changed"), paras[2]].join("\n\n"), updatedAt: created.updatedAt.toISOString() });
      expect(texts()).toHaveLength(1);
      expect(texts()[0]).toContain("changed");
      const rows = await sql`select ord, embedding_model, embedding is not null as has from note_chunk where note_id = ${created.id} order by ord`;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.has && r.embedding_model === embedMod.DEMO_EMBED_MODEL)).toBe(true);
    });

    it("deletes stale chunks when a note shrinks and keeps search_text and tsv in step", async () => {
      const note = await n.createNote(ada, { title: "Shrinking", body: [para("one"), para("two"), para("three")].join("\n\n") });
      expect(await sql`select 1 from note_chunk where note_id = ${note.id}`).toHaveLength(3);
      const [fresh] = await sql`select updated_at from note where id = ${note.id}`;
      await n.updateNote(ada, note.id, { body: "just one now: pangolin", updatedAt: new Date(fresh.updated_at).toISOString() });
      const rows = await sql`select search_text, tsv @@ plainto_tsquery('english','pangolin') as hit from note_chunk where note_id = ${note.id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].search_text).toBe("Shrinking\njust one now: pangolin");
      expect(rows[0].hit).toBe(true);
    });

    it("re-embeds every chunk when the title changes (the title is part of the hash)", async () => {
      const note = await n.createNote(ada, { title: "Old title", body: [para("aa"), para("bb")].join("\n\n") });
      embedSpy.mockClear();
      await n.updateNote(ada, note.id, { title: "New title", updatedAt: note.updatedAt.toISOString() });
      expect(texts()).toHaveLength(2);
    });

    it("leaves notes pending, with search_text written, when the daily embed cap is used up", async () => {
      await setUsage("embed", DAILY);
      const note = await n.createNote(ada, { title: "Capped note", visibility: "workspace", body: "Findable walrus keyword." });
      expect(embedSpy).not.toHaveBeenCalled();
      const [row] = await sql`select index_status from note where id = ${note.id}`;
      expect(row.index_status).toBe("pending");
      const chunks = await sql`select search_text, embedding is null as no_vec from note_chunk where note_id = ${note.id}`;
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({ search_text: "Capped note\nFindable walrus keyword.", no_vec: true });
      expect((await n.keywordSearch(ben, "walrus")).map((h) => h.noteId)).toEqual([note.id]);

      // Admin reindex stops at the cap and reports what is left; once budget returns it finishes.
      expect(await idx.reindexPending()).toEqual({ processed: 1, remaining: 1 });
      await sql`delete from ai_usage`;
      expect(await idx.reindexPending()).toEqual({ processed: 1, remaining: 0 });
      const [after] = await sql`select index_status from note where id = ${note.id}`;
      expect(after.index_status).toBe("ready");
    });

    it("never throws into the request when embedding fails; keyword text is still written", async () => {
      embedSpy.mockRejectedValueOnce(new Error("provider down"));
      const note = await n.createNote(ada, { title: "Offline note", body: "Findable okapi keyword." });
      const [row] = await sql`select index_status from note where id = ${note.id}`;
      expect(row.index_status).toBe("pending");
      const [chunk] = await sql`select embedding is null as no_vec, tsv @@ plainto_tsquery('english','okapi') as hit from note_chunk where note_id = ${note.id}`;
      expect(chunk).toMatchObject({ no_vec: true, hit: true });
      // The failed attempt gave its budget back.
      expect(await sql`select count from ai_usage where kind = 'embed'`).toEqual([{ count: 0 }]);
      await idx.reindexPending();
      expect((await sql`select index_status from note where id = ${note.id}`)[0].index_status).toBe("ready");
    });

    it("embeds more than 32 chunks in batches of at most 32", async () => {
      const big = Array.from({ length: 40 }, (_, i) => para(`w${i}`, 1000)).join("\n\n");
      await sql`delete from ai_usage`;
      process.env.EMBED_DAILY_CHUNKS = "1000";
      (await import("@/lib/env")).resetEnvCache();
      try {
        const note = await n.createNote(ada, { title: "Big", body: big.slice(0, 20000) });
        const sizes = embedSpy.mock.calls.map((c) => (c[0] as { texts: string[] }).texts.length);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(32);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe((await sql`select 1 from note_chunk where note_id = ${note.id}`).length);
      } finally {
        process.env.EMBED_DAILY_CHUNKS = String(DAILY);
        (await import("@/lib/env")).resetEnvCache();
      }
    });

    it("skips the write when the note was edited while embedding", async () => {
      const note = await n.createNote(ada, { title: "Racy", body: "first version" });
      const stale = { ...note, body: "stale text that must not land", updatedAt: new Date(note.updatedAt.getTime() - 5) };
      expect((await idx.indexNote(stale)).status).toBe("skipped");
      expect((await sql`select content from note_chunk where note_id = ${note.id}`)[0].content).toBe("first version");
    });
  });

  describe("ask", () => {
    it("answers end to end in demo mode with no network", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network is off"))));
      const a = await n.createNote(ada, { title: "Walrus handbook", visibility: "workspace", body: "How to feed a walrus: fish, twice a day." });
      await n.createNote(cleo, { title: "Walrus diary", body: "Cleo's private walrus thoughts: fish fish fish." });
      const r = await ask.ask(ben, { question: "How do I feed a walrus?" });
      expect(r.mode).toBe("demo");
      expect(r.found).toBe(true);
      // Fixture cites S1 and S2; only one readable source exists, so S2 is dropped.
      expect(r.citations).toEqual([{ noteId: a.id, title: "Walrus handbook" }]);
      expect(r.answer).toMatch(/\[1\]/);
      expect(r.answer).not.toMatch(/S\d/);
      expect(fetch).not.toHaveBeenCalled();
      const [ev] = await sql`select mode, sources, refused from ask_event where user_id = ${ben.id}`;
      expect(ev).toEqual({ mode: "demo", sources: 1, refused: false });
    });

    it("falls back to keyword search when stored chunks use another embedding model", async () => {
      const w = await n.createNote(ada, { title: "Capybara care", visibility: "workspace", body: "Capybaras need water to bathe in every day." });
      await sql`update note_chunk set embedding_model = 'gemini-embedding-2' where note_id = ${w.id}`;
      const r = await ask.ask(ben, { question: "Do capybaras need water?" });
      expect(r.found).toBe(true); // vector search can't compare these chunks; keyword retrieval found it
      expect(r.citations.map((c) => c.noteId)).toEqual([w.id]);
    });

    it("falls back to keyword search when the embed budget is spent, and when embed() fails", async () => {
      const w = await n.createNote(ada, { title: "Quokka care", visibility: "workspace", body: "Quokkas eat leaves and grass." });
      await setUsage("embed", DAILY);
      const capped = await ask.ask(ben, { question: "What do quokkas eat?" });
      expect(capped.citations.map((c) => c.noteId)).toEqual([w.id]);
      await sql`delete from ai_usage`;
      embedSpy.mockRejectedValueOnce(new Error("down"));
      const r = await ask.ask(ben, { question: "What do quokkas eat?" });
      expect(r.citations.map((c) => c.noteId)).toEqual([w.id]);
    });

    it("refuses an unreadable-only topic in keyword mode too, without leaking", async () => {
      await n.createNote(cleo, { title: "Private axolotl plan", body: "Axolotl heist plan." });
      await setUsage("embed", DAILY);
      const r = await ask.ask(ben, { question: "axolotl heist plan?" });
      expect(r).toMatchObject({ found: false, citations: [], mode: "keyword" });
    });

    it("enforces 20 asks per user per hour (429) and the daily cap (429)", async () => {
      for (let i = 0; i < 20; i++) await sql`insert into ask_event (user_id, mode, sources, refused) values (${ben.id}, 'demo', 0, true)`;
      await expect(ask.ask(ben, { question: "anything?" })).rejects.toMatchObject({ status: 429 });
      // Other users are unaffected; an event older than an hour doesn't count.
      await expect(ask.ask(cleo, { question: "anything?" })).resolves.toMatchObject({ found: false });
      await sql`update ask_event set at = now() - interval '2 hours' where user_id = ${ben.id}`;
      await expect(ask.ask(ben, { question: "anything?" })).resolves.toBeTruthy();

      await sql`delete from ai_usage`;
      await sql`delete from ask_event where user_id like 'rg-%'`;
      const cap = Number(process.env.ASK_DAILY_CAP ?? 300);
      await setUsage("ask", cap);
      await expect(ask.ask(ben, { question: "anything?" })).rejects.toMatchObject({ status: 429 });
      expect(await sql`select 1 from ask_event where user_id = ${ben.id}`).toHaveLength(0);
    });

    it("validates the question and stores no question text", async () => {
      await expect(ask.ask(ben, { question: "x".repeat(501) })).rejects.toMatchObject({ name: "ZodError" });
      await expect(ask.ask(ben, { question: "  " })).rejects.toMatchObject({ name: "ZodError" });
      await ask.ask(ben, { question: "Super secret marmot question" });
      const cols = await sql`select column_name from information_schema.columns where table_name = 'ask_event'`;
      expect(cols.map((c) => c.column_name).sort()).toEqual(["at", "id", "mode", "refused", "sources", "user_id"]);
    });
  });
});
