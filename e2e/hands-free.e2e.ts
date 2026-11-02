import { expect, type Page, test } from "@playwright/test";
import { ask, countAsks } from "./ask.ts";
import { pressMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { finishSpeech, spoken, stubSpeaker, useElevenLabsVoice } from "./speaker-stub.ts";

const first = "The project is called basic.";
const second = "It depends on zod.";

const stubDetector = `
  window.detectorEvents = [];
  window.__MIYAGI_DETECTOR__ = async (detection) => {
    window.detection = detection;
    window.detectorEvents.push("created");
    return {
      start: async () => window.detectorEvents.push("start"),
      pause: async () => window.detectorEvents.push("pause"),
    };
  };
`;

const volumes = (page: Page) => page.evaluate<number[]>("window.volumes");
const aborted = (page: Page) => page.evaluate<string[]>("window.aborted");
const detectorEvents = (page: Page) => page.evaluate<string[]>("window.detectorEvents");

async function hear(page: Page, transcript: string) {
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: transcript } }));
  const transcribed = page.waitForRequest("**/api/transcribe");
  await page.evaluate("window.detection.onSpeechEnd(new Float32Array(16000))");
  return transcribed;
}

async function turnOnDuringTour(page: Page) {
  await ask(page);
  await expect.poll(() => spoken(page)).toEqual([first]);
  await page.getByRole("button", { name: "Hands-free" }).click();
  await expect(page.getByText("Listening hands-free")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubDetector);
  await useElevenLabsVoice(page);
});

test("is off by default, listens once turned on and stops when turned off", async ({ page }) => {
  await ask(page);
  const toggle = page.getByRole("button", { name: "Hands-free" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await detectorEvents(page)).toEqual([]);

  await toggle.click();
  await expect(page.getByText("Listening hands-free")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Listening hands-free")).toBeHidden();
  await toggle.click();

  await expect.poll(() => detectorEvents(page)).toEqual(["created", "pause", "start"]);
});

test("real speech lowers the volume, stops playback and is asked", async ({ page }) => {
  const asks = countAsks(page);
  await turnOnDuringTour(page);

  await page.evaluate("window.detection.onSpeechStart()");
  await expect.poll(() => volumes(page)).toEqual([0.2]);
  expect(await aborted(page)).toEqual([]);
  const transcribed = await hear(page, "What does zod do?");

  expect(transcribed.headers()["content-type"]).toBe("audio/wav");
  await expect.poll(() => asks).toEqual(["How are clips saved?", "What does zod do?"]);
  expect(await aborted(page)).toEqual([first]);
  expect(await volumes(page)).toEqual([0.2, 1]);
});

test("a misfire or an empty transcript restores the volume and playback continues", async ({
  page,
}) => {
  const asks = countAsks(page);
  await turnOnDuringTour(page);

  await page.evaluate("window.detection.onSpeechStart()");
  await page.evaluate("window.detection.onVADMisfire()");
  await page.evaluate("window.detection.onSpeechStart()");
  await hear(page, "");

  await expect.poll(() => volumes(page)).toEqual([0.2, 1, 0.2, 1]);
  expect(await aborted(page)).toEqual([]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([first, second]);
  expect(asks).toEqual(["How are clips saved?"]);
  await expect(page.getByText("Didn't catch that")).toBeHidden();
});

test("speech heard during push-to-talk is asked only once", async ({ page }) => {
  await page.addInitScript(stubMicrophone);
  const asks = countAsks(page);
  await turnOnDuringTour(page);
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: "Why zod?" } }));

  await pressMicrophone(page);
  await page.evaluate("window.detection.onSpeechStart()");
  await page.mouse.up();
  await expect.poll(() => asks).toEqual(["How are clips saved?", "Why zod?"]);
  await page.evaluate("window.detection.onSpeechEnd(new Float32Array(16000))");

  await expect.poll(() => volumes(page)).toEqual([1]);
  expect(asks).toEqual(["How are clips saved?", "Why zod?"]);
});
