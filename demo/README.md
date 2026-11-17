# Recorded demo (Playwright + Screen Studio)

`demo/` holds a scripted walkthrough of Notes and Knowledge Base. Playwright drives a visible Chromium
window at human speed; [Screen Studio](https://www.screen.studio/) records that window on the Mac and
adds the polish (auto-zoom on clicks, smooth cursor, background). Every take is the same, so a re-record
is a re-run.

This is separate from the unit tests: vitest only reads `src/**/*.test.ts` and `test/**/*.test.ts`.

## The story (about a minute)

1. The notes list, then the **Workspace** tab with the seeded team notes.
2. **New note**: type "Holiday coverage plan" as a Workspace note, flip to **Preview**, **Create note**.
3. Back on **Notes**, the new note is in the list.
4. **Ask**: "How many PTO days carry over, and who covers support over the holidays?"
5. The answer appears with numbered citations and a Sources list (with the demo provider: "PTO policy"
   and "Holiday coverage plan").
6. Click the first source to open the note it came from.

## One-time setup

```bash
pnpm install
pnpm exec playwright install chromium     # browser for Playwright (or set DEMO_BROWSER_CHANNEL=chrome)
docker compose up -d db                   # local Postgres with pgvector, if you don't have one
cp .env.example .env.local                # set BETTER_AUTH_SECRET
set -a; source .env.local; set +a
pnpm db:migrate
```

## Demo data and account

The existing demo seed creates four fictional users (`ada@`, `ben@`, `cleo@`, `dev@demo.breakthru.test`)
and 20 realistic team notes. It refuses production hosts. Pick a password of at least 10 characters and
keep it out of the repo:

```bash
export DEMO_PASSWORD="..."                 # type it, don't commit it
DEMO_SEED=yes pnpm seed:demo
```

The demo signs in as **ada@demo.breakthru.test** with that same `DEMO_PASSWORD`
(`DEMO_EMAIL` picks another seeded user). Run the seed again **before every take**: it deletes and
recreates the demo users' notes, so the note the story writes is gone and the lists look the same each
time. Reloading rotates the demo passwords to `DEMO_PASSWORD` and signs the old session out; the demo
notices and signs in again on its own.

## AI

- `AI_PROVIDER=demo` (no key): retrieval is real (deterministic hash embeddings over pgvector) and the
  answer text is a recorded fixture that starts "Demo answer (recorded, not from a live model)" with a
  **Demo** badge. Same result every take.
- For a real answer on camera, set your own `AI_PROVIDER=gemini` and `GEMINI_API_KEY` (or Anthropic) in
  `.env.local`. Re-run the seed after switching so the notes are embedded with the live model. The
  wording changes between takes; citations still point at real notes. `DEMO_QUESTION` changes the
  question.

## Recording a take

1. Start the app. For a clean recording use a production build, which has no Next.js dev badge:
   `pnpm build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js`.
   `pnpm dev` also works (the demo starts it for you if nothing is listening on port 3000).
2. Reset the data: `DEMO_SEED=yes pnpm seed:demo`.
3. Run `pnpm demo` (with `DEMO_PASSWORD` exported). It signs in once and saves the session to
   `demo/.auth/` (gitignored).
4. A 1440×900 Chromium window opens on Notes and waits 5 seconds. In that time, start Screen Studio,
   choose **Window** and click the Chromium window.
5. Playwright plays the story, holds the last screen for 3 seconds and closes the window. Stop the
   recording during the hold.
6. Trim the start and end in Screen Studio and export.

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `DEMO_PASSWORD` | none | Password of the seeded demo users. Only needed when no valid saved session exists. |
| `DEMO_EMAIL` | `ada@demo.breakthru.test` | Seeded user to sign in as. |
| `DEMO_BASE_URL` | `http://localhost:3000` | App to drive. Never point it at production. |
| `DEMO_QUESTION` | PTO / holiday question | Question typed on the Ask page. |
| `DEMO_SLOWMO` | `400` | Milliseconds between Playwright actions. |
| `DEMO_START_DELAY` | `5000` | Milliseconds to wait before the first click. |
| `DEMO_FINAL_HOLD` | `3000` | Milliseconds to hold the last screen. |
| `DEMO_BEATS` | on | `off` skips the reading pauses. |
| `DEMO_HEADLESS` | unset | `1` runs without a window. |
| `DEMO_REAUTH` | unset | `1` signs in again even if the saved session still works. |
| `DEMO_BROWSER_CHANNEL` | unset | `chrome` uses installed Google Chrome. |
| `DEMO_SERVER_CMD` | `pnpm dev` | Command used to start the app if nothing answers `/api/health`. |
| `DEMO_NO_SERVER` | unset | `1` never starts a server. |

## Headless smoke run

`pnpm demo:ci` runs the same story headless with no pauses (a few seconds). It isn't wired into CI
yet; it can become a smoke test later.
