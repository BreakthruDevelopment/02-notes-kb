# Notes and Knowledge Base

App 2 of Breakthru Ventures' **30 apps in 30 days** portfolio — an internal wiki where people write Markdown notes, share them, and ask questions answered only from notes they can read, with citations.

**Live:** https://app2.breakthruventures.ai (Azure Container Apps) · **Runs on:** AWS | Azure | Google Cloud | Oracle Cloud · Part of [30 apps in 30 days](https://github.com/BreakthruDevelopment/ai-dev-os)

> **Notice:** The live demo uses fictional seed data. Do not enter confidential or proprietary information into the free-tier AI.

![Screenshot](docs/screenshot.png)

## What this app does

- **Notes:** Users write Markdown notes (title ≤200 characters, body ≤20,000 characters, up to 100 notes per user) with `private` or `workspace` visibility.
- **Sharing:** Note owners can share notes with specific users by exact email address with either `read` or `edit` permissions. To prevent user account enumeration, sharing is rate-limited to 30 share attempts per hour per user.
- **Keyword search:** Instant full-text search over readable notes using Postgres full-text indexing (`tsvector`/`tsquery`).
- **Ask page:** Ask plain-English questions (≤500 characters) across accessible notes. The AI returns synthesized answers with numbered `[1]` citations linking directly to source notes. If no relevant readable notes cover the question, the system cleanly refuses.
- **Admin panel:** Administrators can view metadata for all notes (where private, unshared titles are masked as "Private note"), monitor daily AI usage against caps, trigger batch reindexing of pending chunks, and click "Load demo workspace" to reset sample data.

## How the AI works

- **Chunking & Indexing:** Markdown notes are split by heading and paragraph into chunks of ≤1,200 characters with 150 characters overlap (≤17 chunks per note). Each chunk computes a SHA-256 hash (`content_hash = sha256(model + title + content)`). Only chunks whose content hash changed are embedded on save. Chunks are embedded with Gemini (`gemini-embedding-2`, 768 dimensions) via the shared AI gateway (`embed()`).
- **Storage & Retrieval:** Chunks and embeddings are stored in Postgres using pgvector with an HNSW cosine index (`vector_cosine_ops`). Retrieval applies note sharing rules inside the same SQL query before vector ranking (`WHERE readableBy(actorId) AND embedding_model = :model ORDER BY embedding <=> :q LIMIT 6`). The model never sees notes the asking user cannot read. On pgvector ≥ 0.8, queries run with `SET LOCAL hnsw.iterative_scan = relaxed_order` (or `hnsw.ef_search = 100`) to prevent ACL filtering from starving the top results.
- **Prompt-Injection Defences:** Retrieved chunks are framed in the prompt as untrusted data inside XML delimiter tags (`<source id="S1" title="...">...</source>`), with delimiters stripped from note content. The system prompt instructs the model to treat sources as passive data, never as instructions. Citations returned by the model are validated against the exact sources sent to it. The model has no tools and cannot execute actions or query outside resources.
- **Budgets & Rate Limits:** Guarded by `EMBED_DAILY_CHUNKS` (default 1,500) and `ASK_DAILY_CAP` (default 300). Users are rate-limited to 20 questions per user per hour. User question text is never stored or logged in the database.
- **Fallbacks & Demo Mode:** If embedding quotas are exceeded or the provider is unavailable, retrieval falls back to Postgres keyword search (`tsvector`). Without an API key or under `AI_PROVIDER=demo`, embeddings use deterministic FNV-1a token hashing into 768 buckets (`demo-hash-768`) for offline vector matching.

## Security model

- **Permissions:**
  - `owner`: Can read, edit, share, revoke, change visibility, and delete the note.
  - `edit` share: Can read and edit note title/body; cannot share, change visibility, or delete.
  - `read` share: Can view the note; cannot edit, share, or delete.
  - `workspace`: Any signed-in user can read.
  - `admin`: Can list metadata for all notes, delete any note, reindex chunks, and view AI usage. **Admin cannot read others' private note bodies or vector chunks.**
- **404 on Unreadable Notes:** Attempting to access an unreadable note returns 404 Not Found rather than 403 Forbidden, concealing the existence of private notes. Attempting to edit a read-only note returns 403 Forbidden.
- **Server-Side Enforcement:** Authorization is verified server-side on every page (`requireUserOrRedirect`, `requireRoleOrRedirect`), route handler, and server action using `assertCan()` and `src/lib/acl.ts`.
- **Request Guards:** Cross-site mutations are blocked with same-origin checks (`assertOrigin`). Mutation inputs are validated with Zod, request bodies are capped, and optimistic concurrency on edits checks `updated_at` (409 on conflict).

## Stack

- **Framework:** Next.js (App Router), TypeScript strict mode.
- **Database & ORM:** Postgres 16 with pgvector extension, Drizzle ORM.
- **Authentication:** Better Auth with role-based access control (`user`, `admin`).
- **Validation:** Zod schemas on all boundaries.
- **Testing:** Vitest for unit, eval, and Postgres integration tests.
- **Styling:** Tailwind CSS with the Breakthru design system tokens.
- **Deployment:** Multi-arch container image on GitHub Container Registry (GHCR), deployed with Terraform via [30-apps-infra](https://github.com/BreakthruDevelopment/30-apps-infra).

## Run it locally

```bash
# 1. Clone and install dependencies
pnpm install

# 2. Start PostgreSQL with pgvector
docker compose up -d db

# 3. Configure environment variables
cp .env.example .env.local
# Set BETTER_AUTH_SECRET with: openssl rand -base64 32

# 4. Run database migrations
pnpm db:migrate

# 5. Seed demo workspace data
DEMO_SEED=yes APP_URL=http://localhost:3000 DEMO_PASSWORD=DemoPassword123! pnpm seed:demo

# 6. Start development server
pnpm dev
```

### Environment Variables

From `.env.example` (names only, never commit secret values):

- `APP_NAME`: Display name of the application.
- `APP_URL`: Public base URL for auth cookies, CORS, and redirects.
- `DATABASE_URL`: PostgreSQL connection string with pgvector support.
- `BETTER_AUTH_SECRET`: Secret key used by Better Auth to encrypt sessions (32+ chars).
- `AI_PROVIDER`: AI provider choice (`demo`, `gemini`, or `anthropic`).
- `AI_MODEL`: Optional model override for text generation.
- `GEMINI_API_KEY`: API key for Google Gemini (free-tier embeddings & generation).
- `ANTHROPIC_API_KEY`: Optional Anthropic API key for Claude.
- `AI_FALLBACK_TO_DEMO`: When `true`, falls back to recorded/demo output on quota error or outage.
- `AI_EMBED_MODEL`: Embedding model identifier (default `gemini-embedding-2`).
- `AI_TIMEOUT_MS`: Timeout in milliseconds for AI gateway calls (default 20,000).
- `EMBED_DAILY_CHUNKS`: Daily limit on chunk embeddings (default 1,500).
- `ASK_DAILY_CAP`: Daily limit on answered questions (default 300).
- `RAG_MAX_DISTANCE`: Maximum cosine distance threshold for vector chunk relevance (default 0.55).
- `LOG_LEVEL`: Application log verbosity (`debug`, `info`, `warn`, `error`).
- `MIGRATE_ON_START`: Set to `true` to run migrations on container start.
- `SEED_ADMIN_EMAIL`: Email for initial admin when using `pnpm db:seed`.
- `SEED_ADMIN_PASSWORD`: Password for initial admin when using `pnpm db:seed`.
- `SEED_USER_EMAIL`: Optional regular user email for `pnpm db:seed`.
- `SEED_USER_PASSWORD`: Optional regular user password for `pnpm db:seed`.

## Checks

```bash
pnpm lint                                  # ESLint
pnpm typecheck                             # TypeScript compiler check
pnpm test                                  # Unit, eval, and mock tests
TEST_DATABASE_URL=postgres://... pnpm test # Integration tests against real Postgres with pgvector
pnpm build                                 # Production Next.js build
pnpm smoke                                 # End-to-end smoke test against running app
```

## 2-minute demo script

Test the core isolation and citation features using the seeded accounts (password `DemoPassword123!` or your configured `DEMO_PASSWORD`):

1. **Ask about workspace knowledge (Ben):**
   - Sign in as `ben@example.com`.
   - Go to `/ask` and ask: `"How many PTO days carry over?"`.
   - **Result:** The AI answers that 5 days carry over, citing `[1]` linked to the workspace **"PTO policy"** note.
2. **Ask about another user's private note (Ben):**
   - In `/ask`, ask: `"When is the Q3 launch?"`.
   - **Result:** Cleo has a private planning note stating October 14, but Ben cannot read it. The AI refuses: *"None of the notes you can read cover this."* Zero sources are cited.
3. **Share the private note (Cleo):**
   - Sign out and sign in as `cleo@example.com`.
   - Open Cleo's private note **"Cleo: Q3 launch planning"**.
   - In the sharing panel, enter `ben@example.com`, select **read**, and click **Share**.
4. **Ask again with newly granted access (Ben):**
   - Sign back in as `ben@example.com`.
   - Go to `/ask` and re-ask: `"When is the Q3 launch?"`.
   - **Result:** The AI now answers October 14, citing `[1]` linked to **"Cleo: Q3 launch planning"**.
5. **Verify read-only enforcement (Ben):**
   - Click the citation link to open **"Cleo: Q3 launch planning"**.
   - Notice the note indicates read-only access; edit, share, and delete controls are not present.
6. **Inspect Admin privacy protections (Ada):**
   - Sign out and sign in as `ada@example.com` (admin).
   - Go to `/admin`.
   - **Result:** The admin metadata table shows all notes across the workspace. For private unshared notes owned by others, the title is masked as **"Private note"**, proving that administrators cannot view private content.
