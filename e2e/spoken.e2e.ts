import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { finishSpeech, spoken, stubSpeaker } from "./speaker-stub.ts";

const first = "The project is called basic.";
const second = "It depends on zod.";
const third = "Clips are saved here.";
const fourth = "Then the clip is uploaded.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(stubSpeaker);
});

test("segments are spoken in order across steps", async ({ page }) => {
  await ask(page);

  await expect.poll(() => spoken(page)).toEqual([first]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second, third]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second, third, fourth]);
});

test("the highlight moves to the next segment after the previous ends", async ({ page }) => {
  await ask(page);
  const lines = page.locator(".cm-line");

  await expect.poll(() => spoken(page)).toEqual([first]);
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(7)).not.toHaveClass(/cm-highlight-current/);

  await finishSpeech(page);

  await expect(lines.nth(7)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-previous/);
});

test("the narration being spoken is hidden, the other segments stay readable", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await expect(page.getByText(first)).toBeHidden();
  await expect(page.getByRole("button", { name: "Segment 1", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByRole("button", { name: second })).toBeVisible();
});

test("clicking a segment plays from there onward", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await page.getByRole("button", { name: third }).click();

  await expect.poll(() => spoken(page)).toEqual([first, third]);
  expect(await page.evaluate("window.aborted")).toEqual([first]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, third, fourth]);
});

test("Pause stops and shows the text, Resume restarts the interrupted segment", async ({
  page,
}) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);

  await page.getByRole("button", { name: "Pause" }).click();

  expect(await page.evaluate("window.aborted")).toEqual([second]);
  await expect(page.getByRole("button", { name: second })).toBeVisible();
  await expect(page.getByRole("button", { name: second })).toHaveAttribute("aria-current", "true");

  await page.getByRole("button", { name: "Resume" }).click();

  await expect.poll(() => spoken(page)).toEqual([first, second, second]);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByText(second)).toBeHidden();
});

test("Pause before the next segment's audio starts resumes at that segment", async ({ page }) => {
  await page.addInitScript("window.holdStarts = true;");
  await ask(page);
  const lines = page.locator(".cm-line");
  await expect.poll(() => spoken(page)).toEqual([first]);
  await page.evaluate("window.startSpeech()");
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(7)).not.toHaveClass(/cm-highlight-current/);

  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Resume" }).click();

  await expect.poll(() => spoken(page)).toEqual([first, second, second]);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.evaluate("window.startSpeech()");
  await expect(lines.nth(7)).toHaveClass(/cm-highlight-current/);
});

test("Voice off stops the audio and falls back to the text player", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);
  const voice = page.getByRole("button", { name: "Voice", exact: true });
  await expect(voice).toHaveAttribute("aria-pressed", "true");

  await voice.click();

  await expect(voice).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate("window.aborted")).toEqual([first]);
  await expect(page.getByRole("button", { name: first })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);

  await page.getByRole("button", { name: third }).click();

  await expect(page.getByRole("button", { name: third })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: fourth })).toHaveAttribute("aria-current", "true");
  expect(await spoken(page)).toEqual([first]);
});

test("the next file is shown about 200 ms before its segment is spoken", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second, third]);

  const [shownAt, spokenAt] = await page.evaluate<number[]>(
    "[window.fileShownAt['src/clip-service.ts'], window.spokenAt[2]]",
  );
  expect((spokenAt ?? 0) - (shownAt ?? 0)).toBeGreaterThanOrEqual(150);
  expect((spokenAt ?? 0) - (shownAt ?? 0)).toBeLessThan(600);
});

test("an earlier tour replayed after an answer without narration reports no new first sound", async ({
  page,
}) => {
  const reported: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/first-sound")) reported.push(request.postDataJSON());
  });
  await ask(page);
  await expect.poll(() => reported.length).toBe(1);

  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"error","message":"Claude Code is not logged in"}\n\ndata: {"type":"done"}\n\n',
    }),
  );
  const box = page.getByLabel("Question");
  await box.fill("And then?");
  await box.press("Enter");

  await expect(page.getByText("Back to where we were")).toBeVisible();
  await expect.poll(() => spoken(page)).toEqual([first, first]);
  await page.waitForTimeout(300);
  expect(reported).toHaveLength(1);
});

test("the time from the question to the first narration sound is reported once", async ({
  page,
}) => {
  const reported = page.waitForRequest((request) => request.url().endsWith("/api/first-sound"));

  await ask(page);

  const request = await reported;
  expect(request.method()).toBe("POST");
  expect(request.headers()["x-miyagi-token"]).toBeTruthy();
  expect(request.postDataJSON().ms).toBeGreaterThan(0);
});
