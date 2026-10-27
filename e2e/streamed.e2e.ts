import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";
import {
  announced,
  finishSpeech,
  finishTour,
  heldAsk,
  sendAskEvent,
  spoken,
  stepEvent,
  stubSpeaker,
} from "./speaker-stub.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(stubSpeaker);
});

test("the first segment is spoken when its step arrives, the next step continues after it", async ({
  page,
}) => {
  await page.addInitScript(heldAsk);
  await ask(page);

  await sendAskEvent(page, stepEvent("Streamed one."));
  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
  await expect(page.locator(".cm-line").nth(0)).toHaveClass(/cm-highlight-current/);

  await finishSpeech(page);
  await sendAskEvent(page, stepEvent("Streamed two."));
  await expect.poll(() => spoken(page)).toEqual(["Streamed one.", "Streamed two."]);
});

test("steps and the tour arriving before the first audio starts do not restart it", async ({
  page,
}) => {
  await page.addInitScript("window.holdStarts = true;");
  await page.addInitScript(heldAsk);
  await ask(page);
  const one = stepEvent("Streamed one.");
  const two = stepEvent("Streamed two.");

  await sendAskEvent(page, one);
  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
  await sendAskEvent(page, two);
  await sendAskEvent(page, {
    type: "tour",
    tour: { question: "How are clips saved?", steps: [one.step, two.step] },
    ranges: [one.ranges, two.ranges],
  });
  await expect(page.getByRole("button", { name: "Streamed two." })).toBeVisible();

  expect(await spoken(page)).toEqual(["Streamed one."]);
  expect(await page.evaluate("window.aborted")).toEqual([]);
  await expect(page.locator(".cm-highlight-current")).toHaveCount(0);
  await page.evaluate("window.startSpeech()");
  await expect(page.locator(".cm-line").nth(0)).toHaveClass(/cm-highlight-current/);
});

test("a step arriving while the user has paused does not start speech", async ({ page }) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  await sendAskEvent(page, stepEvent("Streamed one."));
  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
  await page.getByRole("button", { name: "Pause" }).click();

  await sendAskEvent(page, stepEvent("Streamed two."));

  await expect(page.getByRole("button", { name: "Streamed two." })).toBeVisible();
  expect(await spoken(page)).toEqual(["Streamed one."]);
});

const ackText = "Let me find that.";

test("the acknowledgement starts within 300 ms of submitting", async ({ page }) => {
  await ask(page);

  await expect.poll(() => announced(page)).not.toEqual([]);
  const delay = await page.evaluate<number>("window.announced[0].at - window.submittedAt");
  expect(delay).toBeGreaterThanOrEqual(0);
  expect(delay).toBeLessThan(300);
});

test("the first two progress lines are spoken like a person and later ones only shown", async ({
  page,
}) => {
  await page.addInitScript(heldAsk);
  await ask(page);

  await sendAskEvent(page, { type: "ack", text: ackText });
  await sendAskEvent(page, { type: "progress", text: "Searching for upload or post" });
  await sendAskEvent(page, { type: "progress", text: "Looking at upload.ts" });
  await sendAskEvent(page, { type: "progress", text: "Looking at ask-route.ts" });
  await sendAskEvent(page, { type: "progress", text: "Looking at cli.ts" });

  await expect(page.getByText("Looking at cli.ts")).toBeVisible();
  await expect
    .poll(() => announced(page))
    .toEqual([ackText, "Let me look at upload.", "Now ask route."]);
});

test("a progress line still waiting when a step arrives is dropped", async ({ page }) => {
  await page.addInitScript("window.holdAnnouncements = true;");
  await page.addInitScript(heldAsk);
  await ask(page);

  await sendAskEvent(page, { type: "ack", text: ackText });
  await sendAskEvent(page, { type: "progress", text: "Looking at upload.ts" });
  await sendAskEvent(page, { type: "progress", text: "Finding ClipService" });
  await sendAskEvent(page, stepEvent("Streamed one."));

  await expect.poll(() => announced(page)).toEqual([ackText]);
  expect(await spoken(page)).toEqual([]);
  await expect(page.locator(".cm-highlight-current")).toHaveCount(0);
  await page.evaluate("window.finishAnnouncement()");
  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
  await expect(page.locator(".cm-highlight-current")).not.toHaveCount(0);
  expect(await announced(page)).toEqual([ackText]);
});

test("a failing acknowledgement is skipped and the tour is still spoken", async ({ page }) => {
  await page.addInitScript("window.holdAnnouncements = true;");
  await page.addInitScript(heldAsk);
  await ask(page);
  await sendAskEvent(page, { type: "ack", text: ackText });
  await sendAskEvent(page, stepEvent("Streamed one."));
  await expect.poll(() => announced(page)).toEqual([ackText]);

  await page.evaluate("window.failAnnouncement(new Error('Speech failed: network'))");

  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("progress after the first step is not spoken over the tour", async ({ page }) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  await sendAskEvent(page, { type: "ack", text: ackText });
  await sendAskEvent(page, stepEvent("Streamed one."));
  await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);

  await sendAskEvent(page, { type: "progress", text: "Looking at upload.ts" });
  await sendAskEvent(page, stepEvent("Streamed two."));
  await expect(page.getByRole("button", { name: "Streamed two." })).toBeVisible();

  expect(await announced(page)).toEqual([ackText]);
});

test.describe("check question", () => {
  const check = "What does the save method return?";

  test("is shown after the last step, spoken after the last segment, and then playback waits", async ({
    page,
  }) => {
    await page.addInitScript(heldAsk);
    await ask(page);
    await sendAskEvent(page, stepEvent("Streamed one."));
    await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
    await finishTour(page, check);
    await expect(page.getByText(check)).toBeVisible();
    const pageText = await page.getByRole("main").innerText();
    expect(pageText.indexOf(check)).toBeGreaterThan(pageText.lastIndexOf("Step"));
    expect(await spoken(page)).toEqual(["Streamed one."]);

    await finishSpeech(page);
    await expect.poll(() => spoken(page)).toEqual(["Streamed one.", check]);
    await finishSpeech(page);

    await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await spoken(page)).toEqual(["Streamed one.", check]);
  });

  test("is spoken when the tour event arrives after the last segment has already ended", async ({
    page,
  }) => {
    await page.addInitScript(heldAsk);
    await ask(page);
    await sendAskEvent(page, stepEvent("Streamed one."));
    await expect.poll(() => spoken(page)).toEqual(["Streamed one."]);
    await finishSpeech(page);
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

    await finishTour(page, check);

    await expect.poll(() => spoken(page)).toEqual(["Streamed one.", check]);
  });
});
