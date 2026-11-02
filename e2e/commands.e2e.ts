import { expect, type Page, test } from "@playwright/test";
import { ask, countAsks } from "./ask.ts";
import { holdMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { finishSpeech, spoken, stubSpeaker, useElevenLabsVoice } from "./speaker-stub.ts";

const first = "The project is called basic.";
const second = "It depends on zod.";

async function open(page: Page) {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await useElevenLabsVoice(page);
}

async function say(page: Page, transcript: string) {
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: transcript } }));
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  const transcribed = page.waitForResponse("**/api/transcribe");
  await holdMicrophone(page);
  await transcribed;
  await expect(page.getByText("Transcribing...")).toBeHidden();
}

const rates = (page: Page) => page.evaluate<number[]>("window.rates");

test.beforeEach(async ({ page }) => {
  await open(page);
});

test("skip plays the next segment and go back plays the previous one", async ({ page }) => {
  const asks = countAsks(page);
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await say(page, "Skip.");
  await expect.poll(() => spoken(page)).toEqual([first, second]);

  await say(page, "Go back");
  await expect.poll(() => spoken(page)).toEqual([first, second, first]);
  expect(asks).toEqual(["How are clips saved?"]);
});

test("repeat replays the current segment from its start", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);

  await say(page, "repeat");

  await expect.poll(() => spoken(page)).toEqual([first, second, second]);
});

test("go back at the first segment keeps the narration playing", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await say(page, "Go back.");

  await expect.poll(() => spoken(page)).toEqual([first, first]);
});

test("pause keeps the narration stopped and resume starts the stopped segment again", async ({
  page,
}) => {
  const asks = countAsks(page);
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await say(page, "Pause.");
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  expect(await spoken(page)).toEqual([first]);

  await say(page, "Resume.");
  await expect.poll(() => spoken(page)).toEqual([first, first]);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(asks).toEqual(["How are clips saved?"]);
});

test("slower and faster change the speed by 0.25", async ({ page }) => {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await say(page, "slower");
  await expect.poll(() => spoken(page)).toEqual([first, first]);
  await say(page, "faster");

  await expect.poll(() => rates(page)).toEqual([0.75, 1]);
  await expect.poll(() => spoken(page)).toEqual([first, first, first]);
});

test("a longer sentence that contains a command word is asked as a question", async ({ page }) => {
  const asks = countAsks(page);
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);

  await say(page, "Can you go back to the upload part?");

  await expect
    .poll(() => asks)
    .toEqual(["How are clips saved?", "Can you go back to the upload part?"]);
});

test("a command with no tour on screen is asked as a question", async ({ page }) => {
  const asks = countAsks(page);
  await page.goto("/");

  await say(page, "Pause");

  await expect.poll(() => asks).toEqual(["Pause"]);
});
