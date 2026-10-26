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
