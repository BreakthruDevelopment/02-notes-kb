/**
 * Runs against a real Postgres with pgvector when TEST_DATABASE_URL is set (CI provides one).
 * Creates throwaway databases so it proves migrations apply to an empty database and to one
 * where the extension already exists, without touching the shared test database.
 */
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;

function withDb(base: string, name: string) {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

const vec = (n: number) => `[${Array.from({ length: 768 }, (_, i) => (i === n ? 1 : 0)).join(",")}]`;

describe.skipIf(!url)("notes schema (Postgres + pgvector)", () => {
  const suffix = randomBytes(4).toString("hex");
  const freshName = `schema_fresh_${suffix}`;
  const extName = `schema_ext_${suffix}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  async function migrateInto(name: string, preCreateExtension: boolean) {
    const conn = postgres(withDb(url!, name), { max: 1, onnotice: () => {} });
    try {
      if (preCreateExtension) await conn`CREATE EXTENSION IF NOT EXISTS vector`;
      await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
    } finally {
      await conn.end();
    }
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1 });
    await admin.unsafe(`CREATE DATABASE ${freshName}`);
    await admin.unsafe(`CREATE DATABASE ${extName}`);
    await migrateInto(freshName, false);
    sql = postgres(withDb(url!, freshName), { max: 1 });
    for (const id of ["s-alice", "s-bob"]) {
      await sql`insert into "user" (id, name, email) values (${id}, ${id}, ${id + "@test.local"})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${freshName} WITH (FORCE)`);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${extName} WITH (FORCE)`);
    await admin.end();
  });

  it("enables the vector extension on an empty database", async () => {
    const rows = await sql`select extname from pg_extension where extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it("applies migrations when the extension already exists", async () => {
    await expect(migrateInto(extName, true)).resolves.toBeUndefined();
    const conn = postgres(withDb(url!, extName), { max: 1 });
    try {
      const rows = await conn`select to_regclass('public.note_chunk') as t`;
      expect(rows[0].t).not.toBeNull();
    } finally {
      await conn.end();
    }
  });

  it("removes the template's item table", async () => {
    const rows = await sql`select to_regclass('public.item') as t`;
    expect(rows[0].t).toBeNull();
  });

  it("has a vector(768) embedding column, an HNSW cosine index and a GIN index on tsv", async () => {
    const col = await sql`
      select format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
      where a.attrelid = 'public.note_chunk'::regclass and a.attname = 'embedding'`;
    expect(col[0].type).toBe("vector(768)");

    const idx = await sql`select indexname, indexdef from pg_indexes where tablename = 'note_chunk'`;
    const defs = Object.fromEntries(idx.map((r) => [r.indexname, r.indexdef as string]));
    expect(defs["note_chunk_embedding_hnsw_idx"]).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(defs["note_chunk_tsv_gin_idx"]).toMatch(/USING gin \(tsv\)/);
  });

  async function makeNote(owner: string, title = "T") {
    const [n] = await sql`insert into note (owner_id, title, body) values (${owner}, ${title}, 'body') returning id`;
    return n.id as string;
  }

  it("generates tsv from the chunk text", async () => {
    const noteId = await makeNote("s-alice");
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text)
      values (${noteId}, 0, 'Carry over five vacation days', 'h0', 'PTO policy Carry over five vacation days')`;
    const rows = await sql`
      select 1 from note_chunk where note_id = ${noteId} and tsv @@ websearch_to_tsquery('english', 'vacation')`;
    expect(rows).toHaveLength(1);
  });

  it("orders by cosine distance with the vector column", async () => {
    const noteId = await makeNote("s-alice");
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text, embedding, embedding_model)
      values (${noteId}, 0, 'a', 'ha', 'a', ${vec(1)}::vector, 'demo-hash-768'),
             (${noteId}, 1, 'b', 'hb', 'b', ${vec(2)}::vector, 'demo-hash-768')`;
    const rows = await sql`
      select ord from note_chunk where note_id = ${noteId} order by embedding <=> ${vec(2)}::vector limit 1`;
    expect(rows[0].ord).toBe(1);
  });

  it("enforces unique (note_id, ord)", async () => {
    const noteId = await makeNote("s-alice");
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text) values (${noteId}, 0, 'x', 'h', 'x')`;
    await expect(
      sql`insert into note_chunk (note_id, ord, content, content_hash, search_text) values (${noteId}, 0, 'y', 'h2', 'y')`,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a title over 200 characters", async () => {
    await expect(
      sql`insert into note (owner_id, title) values ('s-alice', ${"x".repeat(201)})`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("deleting a note removes its chunks and shares", async () => {
    const noteId = await makeNote("s-alice");
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text) values (${noteId}, 0, 'x', 'h', 'x')`;
    await sql`insert into note_share (note_id, user_id, permission) values (${noteId}, 's-bob', 'read')`;
    await sql`delete from note where id = ${noteId}`;
    expect(await sql`select 1 from note_chunk where note_id = ${noteId}`).toHaveLength(0);
    expect(await sql`select 1 from note_share where note_id = ${noteId}`).toHaveLength(0);
  });

  it("deleting a user removes their notes, shares granted to them and ask events", async () => {
    const noteId = await makeNote("s-bob", "bob's");
    await sql`insert into note_chunk (note_id, ord, content, content_hash, search_text) values (${noteId}, 0, 'x', 'h', 'x')`;
    const aliceNote = await makeNote("s-alice", "alice's");
    await sql`insert into note_share (note_id, user_id, permission) values (${aliceNote}, 's-bob', 'edit')`;
    await sql`insert into ask_event (user_id, mode, sources, refused) values ('s-bob', 'demo', 0, true)`;

    await sql`delete from "user" where id = 's-bob'`;

    expect(await sql`select 1 from note where id = ${noteId}`).toHaveLength(0);
    expect(await sql`select 1 from note_chunk where note_id = ${noteId}`).toHaveLength(0);
    expect(await sql`select 1 from note_share where user_id = 's-bob'`).toHaveLength(0);
    expect(await sql`select 1 from ask_event where user_id = 's-bob'`).toHaveLength(0);
    // Alice's note survives.
    expect(await sql`select 1 from note where id = ${aliceNote}`).toHaveLength(1);
  });
});
