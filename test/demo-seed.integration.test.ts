import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { demoSeedConfig } from "@/lib/demo-seed-config";
import { ForbiddenError } from "@/lib/auth/rbac";

const current = vi.hoisted(() => ({ actor: { id: "dm-admin", role: "admin" as "admin" | "user", name: "Admin", email: "dm-admin@test.local" } }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async () => {
    if (current.actor.role !== "admin") throw new ForbiddenError();
    return current.actor;
  }),
}));

const base = { DEMO_SEED: "yes", APP_URL: "http://localhost:3000", DEMO_PASSWORD: "demo-test-password-123" };
describe("demo CLI guards", () => {
  it.each([undefined, "no", "true"])("refuses DEMO_SEED=%s", (value) => {
    expect(() => demoSeedConfig({ ...base, DEMO_SEED: value })).toThrow("DEMO_SEED=yes");
  });
  it.each(["https://app2.breakthruventures.ai", "https://APP2.BREAKTHRUVENTURES.AI.:443/path", "https://notes.env.eastus.azurecontainerapps.io", "https://azurecontainerapps.io"])("refuses production URL %s", (APP_URL) => {
    expect(() => demoSeedConfig({ ...base, APP_URL })).toThrow("production host");
  });
  it("refuses a missing or invalid APP_URL with a readable message", () => {
    for (const APP_URL of [undefined, "not a url"]) {
      expect(() => demoSeedConfig({ ...base, APP_URL })).toThrow(/^Demo seed refused: /);
    }
  });
  it("refuses a production host with several trailing dots", () => {
    expect(() => demoSeedConfig({ ...base, APP_URL: "https://app2.breakthruventures.ai.." })).toThrow("production host");
  });
  it("refuses an Azure database host", () => {
    for (const DATABASE_URL of ["postgres://u:p@notes.postgres.database.azure.com:5432/db", "postgres://u:p@NOTES.postgres.database.azure.com./db"]) {
      expect(() => demoSeedConfig({ ...base, DATABASE_URL })).toThrow("production database");
    }
    expect(() => demoSeedConfig({ ...base, DATABASE_URL: "postgres://u:p@localhost:5432/db" })).not.toThrow();
  });
  it("allows a lookalike host that only contains the production name", () => {
    expect(demoSeedConfig({ ...base, APP_URL: "https://app2.breakthruventures.ai.evil.com" }).appUrl).toContain("evil.com");
  });
  it("accepts a local or staging URL with an explicit password", () => {
    expect(demoSeedConfig(base).password).toBe(base.DEMO_PASSWORD);
    expect(demoSeedConfig({ ...base, APP_URL: "https://notes.staging.example.com" }).appUrl).toContain("staging");
    expect(() => demoSeedConfig({ ...base, DEMO_PASSWORD: undefined })).toThrow();
  });
  it.each([
    { ...base, DEMO_SEED: "no" },
    { ...base, APP_URL: "https://app2.breakthruventures.ai" },
    { ...base, APP_URL: "https://notes.eastus.azurecontainerapps.io" },
  ])("the actual CLI exits before connecting to a database (%j)", (values) => {
    const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.mts"], {
      env: { ...process.env, ...values, DATABASE_URL: "postgres://invalid:invalid@127.0.0.1:1/invalid" }, encoding: "utf8", timeout: 10000,
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toContain("Demo seed refused");
    expect(child.stderr).not.toContain("ECONNREFUSED");
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("demo workspace (Postgres + Better Auth)", () => {
  let sql: postgres.Sql;
  let loader: typeof import("@/lib/demo-workspace");
  let notes: typeof import("@/lib/notes");
  let api: ReturnType<typeof import("@/lib/auth").auth>;
  let post: typeof import("@/app/api/admin/demo/route").POST;
  const actor = { id: "dm-admin", role: "admin" as const };
  const real = { id: "dm-real", role: "user" as const };
  const demoEmails = ["ada", "ben", "cleo", "dev"].map((name) => `${name}@demo.breakthru.test`);
  const req = (origin = "http://localhost:3000") => new Request("http://localhost:3000/api/admin/demo", { method: "POST", headers: { origin } });

  async function clean() {
    await sql`delete from "user" where email in ${sql(demoEmails)} or email like 'dm-signup-%'`;
    await sql`delete from note where owner_id in ('dm-real', 'dm-admin')`;
    await sql`delete from rate_event where user_id in ('dm-real', 'dm-admin', 'dm-admin2') or kind = 'demo_load'`;
  }
  beforeAll(async () => {
    Object.assign(process.env, base, { DATABASE_URL: url, BETTER_AUTH_SECRET: "demo-integration-secret-32-characters", AI_PROVIDER: "demo", LOG_LEVEL: "error" });
    const { resetEnvCache } = await import("@/lib/env");
    resetEnvCache();
    sql = postgres(url!, { max: 1, onnotice: () => {} });
    for (const person of [actor, real]) {
      await sql`insert into "user" (id, name, email, role) values (${person.id}, ${person.id}, ${person.id + "@test.local"}, ${person.role}) on conflict (id) do nothing`;
    }
    loader = await import("@/lib/demo-workspace");
    notes = await import("@/lib/notes");
    api = (await import("@/lib/auth")).auth();
    post = (await import("@/app/api/admin/demo/route")).POST;
  });
  beforeEach(async () => {
    await clean();
    current.actor.role = "admin";
  });
  afterAll(async () => {
    await clean();
    await sql`delete from "user" where id in ('dm-admin', 'dm-real')`;
    await sql.end();
  });

  async function snapshot() {
    return sql`select u.email, n.title, n.visibility, n.index_status,
      (select count(*)::int from note_chunk c where c.note_id = n.id and c.embedding is not null and c.embedding_model = 'demo-hash-768') as indexed,
      (select count(*)::int from note_share s where s.note_id = n.id) as shares
      from note n join "user" u on u.id = n.owner_id where u.email in ${sql(demoEmails)} order by u.email, n.title`;
  }

  it("replaces exactly 20 demo notes on reload, indexes every note, and preserves real users' notes", async () => {
    const realNote = await notes.createNote(real, { title: "Real private note", body: "Must survive" });
    expect(await loader.loadDemoWorkspace(actor, { mode: "cli" })).toEqual({ users: 4, notes: 20, indexed: 20 });
    const first = await snapshot();
    expect(first).toHaveLength(20);
    expect(first.every((n) => n.index_status === "ready" && n.indexed > 0)).toBe(true);
    expect(first.filter((n) => n.visibility === "workspace")).toHaveLength(6);
    expect(first.filter((n) => n.shares > 0)).toHaveLength(6);
    expect(first.filter((n) => n.visibility === "private" && n.shares === 0)).toHaveLength(8);
    const [{ id: cleoId }] = await sql`select id from "user" where email = 'cleo@demo.breakthru.test'`;
    const [{ id: benId }] = await sql`select id from "user" where email = 'ben@demo.breakthru.test'`;
    const [{ id: projectId }] = await sql`select id from note where owner_id = ${cleoId} and title = 'Project plan'`;
    expect((await notes.getNote({ id: benId, role: "user" }, projectId)).access).toBe("read");
    await expect(notes.updateNote({ id: benId, role: "user" }, projectId, { body: "no", updatedAt: new Date().toISOString() })).rejects.toMatchObject({ status: 403 });
    await notes.shareNote(real, realNote.id, { email: "ben@demo.breakthru.test", permission: "read" });
    await notes.createNote({ id: cleoId, role: "user" }, { title: "Extra demo note", body: "Replace me" });
    expect(await loader.loadDemoWorkspace(actor, { mode: "cli" })).toEqual({ users: 4, notes: 20, indexed: 20 });
    expect(await snapshot()).toEqual(first);
    expect((await notes.getNote(real, realNote.id)).body).toBe("Must survive");
    expect(await notes.listShares(real, realNote.id)).toHaveLength(1);
    const [{ role }] = await sql`select role from "user" where email = 'ada@demo.breakthru.test'`;
    expect(role).toBe("admin");
    expect((await api.api.signInEmail({ body: { email: "ada@demo.breakthru.test", password: base.DEMO_PASSWORD } })).user.id).toBeTruthy();
    const [{ body }] = await sql`select n.body from note n join "user" u on u.id = n.owner_id where n.title = 'PTO policy' and u.email = 'ada@demo.breakthru.test'`;
    expect(body).toContain("up to 5 unused PTO days carry over to next year");
  }, 30000);

  it("the CLI loads the workspace end to end", async () => {
    const child = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.mts"], {
      env: { ...process.env, ...base, DATABASE_URL: url }, encoding: "utf8", timeout: 20000,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("4 demo users and 20 notes (20 indexed)");
    expect(await snapshot()).toHaveLength(20);
  }, 25000);

  it("a fresh route load creates four normal users and no known credentials", async () => {
    expect((await post(req())).status).toBe(200);
    expect((await sql`select role from "user" where email in ${sql(demoEmails)}`).every((u) => u.role === "user")).toBe(true);
    const hashes = await sql`select a.password from account a join "user" u on u.id = a.user_id where u.email in ${sql(demoEmails)}`;
    expect(hashes).toHaveLength(4);
    expect(new Set(hashes.map((a) => a.password)).size).toBe(4);
    await expect(loader.loadDemoWorkspace(real)).rejects.toMatchObject({ status: 403 });
    await expect(loader.loadDemoWorkspace(actor, { mode: "cli", password: "override" })).rejects.toMatchObject({ name: "ZodError" });
  }, 30000);

  it("route keeps demo users unprivileged, invalidates prior sessions and passwords, and rejects a second load", async () => {
    await loader.loadDemoWorkspace(actor, { mode: "cli" });
    const signed = await api.api.signInEmail({ body: { email: "ada@demo.breakthru.test", password: base.DEMO_PASSWORD } });
    const response = await post(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ users: 4, notes: 20, indexed: 20 });
    expect((await sql`select role from "user" where email in ${sql(demoEmails)}`).every((u) => u.role === "user")).toBe(true);
    expect(await sql`select 1 from session where token = ${signed.token}`).toHaveLength(0);
    for (const email of demoEmails) {
      await expect(api.api.signInEmail({ body: { email, password: base.DEMO_PASSWORD } })).rejects.toBeDefined();
    }
    expect((await post(req())).status).toBe(429);
    expect(await snapshot()).toHaveLength(20);
  }, 30000);

  it("route rejects non-admins and foreign/missing Origin before loading or reserving a call", async () => {
    current.actor.role = "user";
    expect((await post(req())).status).toBe(403);
    current.actor.role = "admin";
    expect((await post(req("https://other.breakthruventures.ai"))).status).toBe(403);
    expect((await post(new Request("http://localhost:3000/api/admin/demo", { method: "POST" }))).status).toBe(403);
    expect(await sql`select 1 from rate_event where kind = 'demo_load'`).toHaveLength(0);
    expect(await snapshot()).toHaveLength(0);
  });

  it("reserves one call under concurrency, expires after a minute, and isolates admins", async () => {
    const results = await Promise.allSettled([loader.reserveDemoLoad(actor), loader.reserveDemoLoad(actor)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 429 });
    await sql`update rate_event set at = now() - interval '61 seconds' where user_id = ${actor.id} and kind = 'demo_load'`;
    await loader.reserveDemoLoad(actor);
    await sql`update "user" set role = 'admin' where id = ${real.id}`;
    await expect(loader.reserveDemoLoad({ ...real, role: "admin" })).rejects.toMatchObject({ status: 429 });
    await expect(loader.reserveDemoLoad(real)).rejects.toMatchObject({ status: 403 });
    await sql`update "user" set role = 'user' where id = ${real.id}`;
  });

  it("survives 16 consecutive loads (share rate events reset) with exactly 20 notes", async () => {
    for (let i = 0; i < 16; i++) await loader.loadDemoWorkspace(actor, { mode: "cli" });
    expect(await snapshot()).toHaveLength(20);
  }, 120000);

  it("serializes concurrent loads", async () => {
    await Promise.all([loader.loadDemoWorkspace(actor, { mode: "cli" }), loader.loadDemoWorkspace(actor, { mode: "cli" })]);
    expect(await snapshot()).toHaveLength(20);
  }, 60000);

  it("public sign-up and profile update cannot claim a demo email or the marker, while the loader still works", async () => {
    const signUp = (payload: Record<string, unknown>) => api.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ name: "Mallory", password: base.DEMO_PASSWORD, ...payload }),
    }));
    expect((await signUp({ email: "mallory@demo.breakthru.test" })).status).toBe(400);
    expect((await signUp({ email: "dm-signup-marker@test.local", image: "urn:breakthru:notes-demo:v1" })).status).toBe(400);
    expect(await sql`select 1 from "user" where email in ('mallory@demo.breakthru.test', 'dm-signup-marker@test.local')`).toHaveLength(0);
    expect((await signUp({ email: "dm-signup-ok@test.local" })).status).toBe(200);
    // Profile update: an existing real user cannot adopt the marker over HTTP.
    const cookie = (await signUp({ email: "dm-signup-two@test.local" })).headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const update = await api.handler(new Request("http://localhost:3000/api/auth/update-user", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie },
      body: JSON.stringify({ image: "urn:breakthru:notes-demo:v1" }),
    }));
    expect(update.status).toBe(400);
    expect(await sql`select 1 from "user" where email = 'dm-signup-two@test.local' and image is not null`).toHaveLength(0);
    expect(await loader.loadDemoWorkspace(actor, { mode: "cli" })).toEqual({ users: 4, notes: 20, indexed: 20 });
  }, 30000);

  it("keeps Cleo's launch note hidden from Ben until she shares it", async () => {
    await loader.loadDemoWorkspace(actor, { mode: "cli" });
    const [{ id: benId }] = await sql`select id from "user" where email = 'ben@demo.breakthru.test'`;
    const [{ id: noteId }] = await sql`select n.id from note n join "user" u on u.id = n.owner_id where u.email = 'cleo@demo.breakthru.test' and n.body like '%October 14%'`;
    await expect(notes.getNote({ id: benId, role: "user" }, noteId)).rejects.toMatchObject({ status: 404 });
  }, 30000);

  it("refuses to adopt an unrelated account at a demo address", async () => {
    const collision = await api.api.createUser({ body: { email: "ada@demo.breakthru.test", name: "Real Ada", password: base.DEMO_PASSWORD } });
    const owner = { id: collision.user.id, role: "user" as const };
    const note = await notes.createNote(owner, { title: "Not demo data", body: "Keep this" });
    await expect(loader.loadDemoWorkspace(actor)).rejects.toMatchObject({ status: 409 });
    expect((await notes.getNote(owner, note.id)).body).toBe("Keep this");
    expect((await api.api.signInEmail({ body: { email: collision.user.email, password: base.DEMO_PASSWORD } })).user.id).toBe(owner.id);
  });
});
