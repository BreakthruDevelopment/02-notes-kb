/**
 * Notes KB demo story, about a minute headed:
 *   write a workspace note -> see it in the notes list -> Ask a question -> answer with numbered
 *   citations -> click a citation to open the source note.
 *
 * Signs in as a seeded demo user (default ada@demo.breakthru.test; see demo/README.md). Reload the
 * demo workspace before each take (`DEMO_SEED=yes pnpm seed:demo`); it deletes and recreates the
 * demo users' notes, including the one this story writes.
 *
 * AI: with AI_PROVIDER=demo the answer is a recorded fixture ("Demo answer (recorded...)") over
 * real retrieval, so it's the same every take. With a Gemini or Anthropic key set locally the
 * answer is live and its wording changes between takes; the citations still point at real notes.
 */
import { expect, test } from "@playwright/test";
import { beat, finalHold, startDelay, typeSlowly } from "./helpers";

const NOTE_TITLE = "Holiday coverage plan";
const NOTE_BODY = [
  "# Holiday coverage",
  "",
  "Dev and Cleo cover support from December 22 to January 2.",
  "Book holiday PTO by December 1 so the rota is final.",
  "Only 5 unused PTO days carry over to next year.",
].join("\n");
const QUESTION = process.env.DEMO_QUESTION ?? "How many PTO days carry over, and who covers support over the holidays?";

test("Notes KB: write a note, then ask and follow a citation", async ({ page }) => {
  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: "Notes", exact: true })).toBeVisible();
  await startDelay(page);

  // 1. The notes list: the seeded team workspace.
  await beat(page, 2_000);
  await page.getByRole("navigation", { name: "Note lists" }).getByRole("link", { name: "Workspace" }).click();
  await beat(page);

  // 2. Write a new Markdown note and share it with the workspace.
  await page.getByRole("link", { name: "New note" }).first().click();
  await expect(page.getByRole("heading", { name: "New note" })).toBeVisible();
  await page.getByLabel("Title").click();
  await typeSlowly(page, NOTE_TITLE);
  await page.getByLabel("Visibility").selectOption("workspace");
  await beat(page, 600);
  await page.getByRole("textbox", { name: "Body" }).click();
  await typeSlowly(page, NOTE_BODY);
  await beat(page, 800);
  await page.getByRole("tab", { name: "Preview" }).click();
  await beat(page);
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByRole("heading", { name: NOTE_TITLE })).toBeVisible();
  await beat(page);

  // 3. Back to the list: the new note is there.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Notes" }).click();
  await expect(page.getByRole("link", { name: NOTE_TITLE }).first()).toBeVisible();
  await beat(page, 2_000);

  // 4. Ask a plain-English question across every note this user can read.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ask" }).click();
  await page.getByRole("textbox", { name: "Question" }).click();
  await typeSlowly(page, QUESTION);
  await beat(page, 600);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const answer = page.getByRole("heading", { name: "Answer" });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await answer.scrollIntoViewIfNeeded();
  await beat(page, 2_500);

  // 5. Numbered citations link to the notes the answer came from. Open the first source.
  const sources = page.getByRole("listitem").filter({ has: page.locator('a[href^="/notes/"]') });
  await expect(sources.first()).toBeVisible();
  const source = sources.first().getByRole("link");
  const sourceTitle = (await source.textContent())?.trim() ?? "";
  await source.hover();
  await beat(page, 800);
  await source.click();
  await expect(page.getByRole("heading", { name: sourceTitle })).toBeVisible();
  await beat(page);
  await page.mouse.wheel(0, 300);
  await finalHold(page);
});
