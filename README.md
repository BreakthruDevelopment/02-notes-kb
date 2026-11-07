# Notes and Knowledge Base

> An internal wiki you can ask plain-English questions of, with verifiable source citations and strict per-note ACLs enforced in SQL.

**Live:** https://app2.breakthruventures.ai · **Runs on:** AWS | Azure | Google Cloud | Oracle Cloud · Part of
[30 apps in 30 days](https://github.com/BreakthruDevelopment/ai-dev-os)

![Screenshot](docs/screenshot.png)

## What it does

Teams hire this app as an internal knowledge base where members write short Markdown notes (runbooks, policies, meeting notes), share them selectively, and ask plain-English questions that are answered strictly from readable notes:

- **Create and organize Markdown notes:** Authors write notes (title ≤200 chars, body ≤20,000 chars, up to 100 notes per user) with private, shared, or workspace visibility and live preview.
- **Granular per-user sharing:** Note owners share notes directly with specific users by email address with either `read` or `edit` permissions, or revoke access at any time.
- **Ask questions with inline citations:** Users query their accessible knowledge base to receive synthesized answers with direct `[1]` citation markers linking back to source notes.
- **Strict isolation by design:** Private notes remain strictly private. The retrieval and answering pipeline guarantees answers never cite, summarize, or leak content from notes the asking user cannot read.
- **Administrative visibility without overreach:** Admins monitor AI usage against daily budgets, reindex pending notes, manage user accounts, and view note metadata without ever accessing private note bodies or vector chunks.

## Roles & Access Control (ACL)

| Role | Permissions |
| --- | --- |
| **Public** (signed out) | Landing page with demo-data disclaimer; account sign-up and sign-in. |
| **User** | Create notes; view notes they own, notes shared with them, and workspace notes; edit owned notes and `edit`-shared notes; share owned notes; query `/ask` over readable notes. |
| **Admin** | Everything a standard user can do on **their own** notes. Plus: view metadata for all notes (title, owner, visibility, share count, indexing status; **never** note body or chunks), delete any note, trigger background reindexing, view AI usage counters vs caps, and manage user accounts. |

### The "Admin-Can't-Read-Private" Architectural Decision

In standard team wikis, admin accounts often have universal read overrides. In this application, **admin does not read others' private notes**. "Private means private" is the foundational security guarantee for confidential 1:1 notes, drafts, and sensitive documentation.

The template's default universal bypass (`can()`) is bypassed for notes. Instead, note access is governed by granular, non-bypassing predicates (`canReadNote`, `canEditNote`, `canManageNote`). An admin querying the `/ask` endpoint or browsing notes operates under the identical ACL filter as standard users. Viewing private note bodies would require audited, database-level break-glass procedures, not application-level privileges.

### The ACL in SQL

Access control is evaluated directly within PostgreSQL using a single Drizzle `sql` fragment:

- **Readable:** `owner_id = :userId OR visibility = 'workspace' OR EXISTS (SELECT 1 FROM note_share WHERE note_id = note.id AND user_id = :userId)`
- **Editable:** `owner_id = :userId OR EXISTS (SELECT 1 FROM note_share WHERE note_id = note.id AND user_id = :userId AND permission = 'edit')`
- **Manageable (share, visibility):** `owner_id = :userId` (deletion also permitted by admin).
- **Existence Masking:** Requests for unreadable notes return **404 Not Found** instead of 403 Forbidden so note existence is never leaked. Readable notes lacking edit rights return **403 Forbidden** on modification attempts.

## The AI Feature

The AI subsystem provides automated chunk indexing (`embed-note`), semantic question embedding (`embed-query`), and RAG-based cited answer generation (`rag-answer`) via the central `generate()` gateway.

### ACL-Filtered Retrieval Before Ranking

To prevent unauthorized data leakage and avoid candidate starvation:

1. **Pre-Ranking Filtering:** The user's question embedding is matched against candidate note chunks in a single SQL query where the ACL fragment is embedded inside the `WHERE` clause:
   ```sql
   WHERE <readable by :userId>
     AND embedding_model = :currentModel
   ORDER BY embedding <=> :queryVector
   LIMIT 6;
   ```
2. **Preventing Starvation:** Using PostgreSQL `pgvector`, filtering unreadable chunks after vector ranking could starve the result set if top matches are private to others. Applying the ACL inside the `WHERE` clause guarantees only authorized chunks are evaluated. On pgvector ≥ 0.8, queries run with `SET LOCAL hnsw.iterative_scan = strict_order` (or `hnsw.ef_search = 100`).
3. **Distance Cutoff:** Chunks are filtered by cosine distance threshold (`RAG_MAX_DISTANCE`, default `0.55`). Chunks exceeding this distance are discarded.

### Citations and Refusal

- **Strict Citations:** Answers include source references mapped to source IDs (`S1`–`S6`). Any citation referencing an unretrieved source is stripped server-side.
- **Refusal Paths:** If no chunks meet the distance threshold or no readable notes match the query, the model refuses cleanly (`found: false`), emitting no citations and executing no extraneous generation calls. Questions about out-of-domain topics (e.g., general trivia not in notes) are refused.
- **Output Schema:**
  ```ts
  z.object({
    found: z.boolean(),
    answer: z.string().max(1500),
    citations: z.array(z.string().regex(/^S[1-6]$/)).max(6),
  })
  ```

### Prompt Injection Defence

1. **Pre-Retrieval Isolation:** Attackers cannot inject instructions through unreadable notes because inaccessible chunks are never retrieved or supplied to the model context.
2. **Untrusted Data Framing:** Chunks are framed in the prompt strictly as data inside delimited XML blocks (`<source id="S1" title="...">...</source>`) with delimiter characters stripped from note bodies. The system prompt explicitly instructs the model to treat all source content as passive text, never as instructions.
3. **No Tool Execution:** The model operates without tools or mutation capabilities; it cannot modify permissions, create notes, or reveal hidden data.
4. **Server-Side Validation:** The JSON output schema is strictly parsed with Zod. Citations outside the retrieved set are discarded, preventing injection payloads from tricking the model into hallucinating unauthorized titles or sources.
5. **XSS Protection:** The Markdown renderer disables raw HTML and restricts links to `http(s)` and `mailto` protocols with `rel="noopener nofollow"`.

### Budgets, Indexing & Fallbacks

- **Smart Chunking & Hash Diffing:** Markdown notes are split by heading and paragraph into chunks ≤1,200 characters with 150 characters overlap (≤17 chunks per note). Chunks compute a SHA-256 hash (`sha256(model + title + content)`). Updates only re-embed chunks whose content hash changed, executed in a single batch call.
- **Daily Caps:** Operations are bounded by daily limits across the application:
  - `EMBED_DAILY_CHUNKS` (default 1,500 chunks/day).
  - `ASK_DAILY_CAP` (default 500 questions/day).
- **Postgres Full-Text Search (FTS) Fallback:** If embedding limits are reached, the embed API fails, or a live model queries an index with pending vectors, the system automatically falls back to full-text search (`websearch_to_tsquery` and `ts_rank` over generated `tsv` columns) preserving ACL constraints.
- **Offline Demo Mode (`demo-hash-768`):** In demo mode (`AI_PROVIDER=demo`) or when API keys are absent, embeddings use deterministic FNV-1a token hashing into 768-dimensional normalized vectors, providing lexical offline vector search without network dependencies or external API calls.

### Demo-Data-Only Warning

> **Notice:** Shared free-tier AI services (such as Google Gemini free tier) may use submitted prompts for model improvement. A persistent disclaimer banner is displayed on `/`, `/notes/new`, and `/ask`. Do not enter sensitive, proprietary, or confidential data. No user question text is permanently stored or logged in the database.

## Architecture

```
Browser (desktop and phone)
   │ HTTPS + session cookie
   ▼
Azure Container Apps ──► Next.js container (App Router)
                            │                  auth + ACL, zod validation, AI gateway, JSON logs
                            ├──► Azure Flexible Server Postgres (pgvector + Drizzle ORM)
                            └──► Model API (Gemini free tier, Claude, or deterministic demo embeddings)
```

| Concern | Where |
| --- | --- |
| Config & Env Validation | `src/lib/env.ts` |
| Database Schema & Migrations | `src/lib/db/schema.ts`, `drizzle/` (`enable-pgvector`, `notes-schema`) |
| Authentication & Sessions | `src/lib/auth/` (Better Auth + admin plugin) |
| Access Control (ACL) | `src/lib/acl.ts` (SQL fragments and authorization helpers) |
| Notes Data Layer | `src/lib/notes.ts` (CRUD, sharing, concurrency, search) |
| AI Gateway & Embeddings | `src/lib/ai/` (chunker, `embed()`, `generate()`, demo fallback) |
| Health Check | `GET /api/health` (returns 503 if database connection fails) |

## Environment Variables

Names only (never commit secret values):

| Variable | Description |
| --- | --- |
| `APP_NAME` | Display name of the application |
| `APP_URL` | Base public URL for auth redirects, CORS, and cookie scoping |
| `DATABASE_URL` | PostgreSQL connection string (must have `vector` extension support) |
| `TEST_DATABASE_URL` | Scratch PostgreSQL connection string for integration test suite |
| `BETTER_AUTH_SECRET` | Secret key used by Better Auth to encrypt session cookies (32+ chars) |
| `AI_PROVIDER` | AI provider choice (`gemini`, `anthropic`, or `demo`) |
| `AI_MODEL` | Text generation model identifier |
| `AI_EMBED_MODEL` | Text embedding model identifier (e.g. `gemini-embedding-2`) |
| `GEMINI_API_KEY` | Google Gemini API key for free-tier embeddings and generation |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models |
| `AI_TIMEOUT_MS` | Gateway call timeout in milliseconds (default 20,000) |
| `AI_FALLBACK_TO_DEMO` | Fallback to recorded demo answers on rate limits or outages (`true`/`false`) |
| `EMBED_DAILY_CHUNKS` | Maximum chunks embedded per day (default 1,500) |
| `ASK_DAILY_CAP` | Maximum ask questions answered per day (default 500) |
| `RAG_MAX_DISTANCE` | Maximum cosine distance threshold for vector chunk relevance (default 0.55) |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `MIGRATE_ON_START` | Automatically execute pending migrations on container start (`true`/`false`) |
| `DEMO_SEED` | Guard flag requiring `yes` to execute `pnpm seed:demo` |
| `DEMO_PASSWORD` | Password assigned to demo users during seed |
| `SEED_ADMIN_EMAIL` | Email address for initial bootstrap administrator |
| `SEED_ADMIN_PASSWORD` | Password for initial bootstrap administrator |

## Run locally

```bash
cp .env.example .env.local          # set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d db
pnpm install
pnpm db:migrate
pnpm dev                            # http://localhost:3000
```

To bootstrap an admin user in development:
```bash
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=your-secure-password pnpm db:seed
```

## Seed Demo Data

To populate the application with realistic sample notes, runbooks, and test accounts:

```bash
DEMO_SEED=yes DEMO_PASSWORD=DemoPassword123! pnpm seed:demo
```

The seed script creates four test users and 20 categorized notes:
- **Users:** Ada (`ada@example.com`, admin), Ben (`ben@example.com`), Cleo (`cleo@example.com`), Dev (`dev@example.com`).
- **Notes:** 6 workspace notes (company handbook, PTO policy, deploy runbook, incident postmortem, engineering style guide, prompt injection test), 8 private notes (1:1 meeting records, confidential customer notes), and 6 selectively shared notes.
- **Safety Guard:** Refuses execution unless `DEMO_SEED=yes` and blocks execution against production hostnames (`app2.breakthruventures.ai` or `*.azurecontainerapps.io`).

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test   # unit and eval tests
TEST_DATABASE_URL=postgres://... pnpm test # runs Postgres integration tests (ACL & pgvector)
pnpm build && pnpm smoke                   # container build and end-to-end smoke test
```

## Deploy it yourself

The application image deploys across Azure Container Apps, AWS, Google Cloud Run, and Oracle Cloud. Infrastructure as Code configurations are maintained in [BreakthruDevelopment/30-apps-infra](https://github.com/BreakthruDevelopment/30-apps-infra). See `infra/README.md` for cloud deployment targets.

## 2-minute demo script

This scenario demonstrates per-note ACL enforcement in semantic search: Ben asks a question about Cleo's private note, the system safely refuses without leaking content, Cleo grants read permission, and Ben's query immediately cites the newly accessible note.

1. **Sign in as Ben (`/sign-in`):**
   - Sign in using `ben@example.com` / `DemoPassword123!`.
   - Navigate to `/notes`. Notice the tabs: *Mine*, *Shared with me*, and *Workspace*. Ben can see workspace documentation and his personal notes, but none of Cleo's private files.
2. **Ask a question about private knowledge (`/ask`):**
   - In the question box, enter: `"What were the key takeaways from the Q3 Alpha client meeting?"`.
   - Submit the query.
   - **Verification:** The system returns a polite refusal stating no relevant readable information was found (`found: false`), with zero source citations. Cleo's private meeting note remains completely invisible to the retrieval engine.
3. **Sign in as Cleo and share the note:**
   - Sign out and sign in as `cleo@example.com` / `DemoPassword123!`.
   - Open Cleo's private note: **"Q3 Alpha Client Debrief"**.
   - In the note's **Share** panel, enter `ben@example.com`, select **Can read**, and click **Share**.
   - Note that Cleo retains full ownership while granting read-only access to Ben.
4. **Ben queries again with citation proof (`/ask`):**
   - Sign back in as `ben@example.com`.
   - Return to `/ask` and re-submit the identical question: `"What were the key takeaways from the Q3 Alpha client meeting?"`.
   - **Verification:** The AI now synthesizes a direct answer citing key takeaways, accompanied by an inline `[1]` citation badge linking directly to Cleo's **"Q3 Alpha Client Debrief"** note.
5. **Inspect the Admin Panel (`/admin`):**
   - Sign in as `ada@example.com` (administrator).
   - Navigate to `/admin`.
   - **Verification:** View the system overview: AI usage counters versus daily caps, pending chunk reindex triggers, and the note metadata catalog. Point out that the admin catalog displays titles, owners, and sharing counts, but **never** exposes private note bodies or vector chunks, demonstrating the "admin-can't-read-private" rule in action.
