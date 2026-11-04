import { expect, type Page, test } from "@playwright/test";
import { ask, bodiesPostedTo } from "./ask.ts";
import { holdMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { finishSpeech, spoken, stubSpeaker, useElevenLabsVoice } from "./speaker-stub.ts";

const file = "src/clip-service.ts";
const step = {
  title: "Saving a clip",
  anchors: [{ file, symbol: "ClipService.save" }],
  narration: [{ text: "Save returns the clip.", anchor: 0 }],
  primm: {
    predict: "What does save return?",
    investigate: "Click the line that returns the clip.",
    target: { file, line: 3, text: "return clip;" },
  },
};
const ranges = [
  { file, start: 2, end: 4, capped: false },
  { file, start: 3, end: 3, capped: false },
];
const checkQuestion = "How would you change this to save twice?";

async function startTour(page: Page) {
  await page.addInitScript(stubSpeaker);
  const events = [
    { type: "step", step, ranges },
    {
      type: "tour",
      tour: {
        question: "How are clips saved?",
        steps: [step],
        checkQuestion,
        checkConcept: "clip saving",
      },
      ranges: [ranges],
    },
    { type: "done" },
  ];
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    }),
  );
  await ask(page);
}

async function speaksNext(page: Page, text: string) {
  await expect.poll(() => spoken(page)).toContain(text);
  await finishSpeech(page);
}

const skipChip = (page: Page) => page.locator("form").getByRole("button", { name: "Skip" });

test("the tutor asks for a prediction before the narration, speaks the feedback, then plays the narration", async ({
  page,
}) => {
  const bodies = bodiesPostedTo(page, "/api/predict");
  await page.route("**/api/predict", (route) => route.fulfill({ json: { feedback: "Close." } }));
  await startTour(page);

  await expect.poll(() => spoken(page)).toEqual(["What does save return?"]);
  await expect(page.getByText("Predict: What does save return?")).toBeVisible();
  await finishSpeech(page);
  const box = page.getByLabel("Question");
  await box.fill("It returns the clip");
  await box.press("Enter");

  await expect
    .poll(() => bodies)
    .toEqual([{ tour: "How are clips saved?", step: 0, prediction: "It returns the clip" }]);
  await expect.poll(() => spoken(page)).toEqual(["What does save return?", "Close."]);
  await finishSpeech(page);
  await expect
    .poll(() => spoken(page))
    .toEqual(["What does save return?", "Close.", "Save returns the clip."]);
  await expect(page.getByText("Predict: What does save return?")).toBeHidden();
});

test("skipping the prediction goes straight to the narration without asking the server", async ({
  page,
}) => {
  const bodies = bodiesPostedTo(page, "/api/predict");
  const skipped = bodiesPostedTo(page, "/api/skipped");
  await startTour(page);
  await speaksNext(page, "What does save return?");

  await skipChip(page).click();

  await expect
    .poll(() => spoken(page))
    .toEqual(["What does save return?", "Save returns the clip."]);
  expect(bodies).toEqual([]);
  expect(skipped).toEqual([]);
});

test("skipping the investigate step tells the server nothing about a skipped question", async ({
  page,
}) => {
  const skipped = bodiesPostedTo(page, "/api/skipped");
  await startTour(page);
  await speaksNext(page, "What does save return?");
  await skipChip(page).click();
  await speaksNext(page, "Save returns the clip.");
  await expect(page.getByText("Investigate:")).toBeVisible();

  await skipChip(page).click();

  await expect(page.getByText("Investigate:")).toBeHidden();
  expect(skipped).toEqual([]);
});

test("a spoken prediction is checked as a prediction, even when it sounds like a command", async ({
  page,
}) => {
  await page.addInitScript(stubMicrophone);
  await useElevenLabsVoice(page);
  const bodies = bodiesPostedTo(page, "/api/predict");
  await page.route("**/api/predict", (route) => route.fulfill({ json: { feedback: "Close." } }));
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: "skip" } }));
  await startTour(page);
  await expect.poll(() => spoken(page)).toEqual(["What does save return?"]);
  await finishSpeech(page);

  await holdMicrophone(page);

  await expect
    .poll(() => bodies)
    .toEqual([{ tour: "How are clips saved?", step: 0, prediction: "skip" }]);
  await expect.poll(() => spoken(page)).toEqual(["What does save return?", "Close."]);
});

test("after the narration the learner finds the line; a click on it is right and keeps it highlighted", async ({
  page,
}) => {
  await startTour(page);
  await speaksNext(page, "What does save return?");
  await skipChip(page).click();
  await speaksNext(page, "Save returns the clip.");
  await expect.poll(() => spoken(page)).toContain("Click the line that returns the clip.");
  await expect(page.getByText("Investigate: Click the line that returns the clip.")).toBeVisible();
  const lines = page.locator(".cm-line");
  await expect(page.locator(".cm-highlight-current")).toHaveCount(0);
  await finishSpeech(page);

  await lines.nth(2).click();

  await expect.poll(() => spoken(page)).toContain("That's right.");
  await expect(lines.nth(2)).toHaveClass(/cm-highlight-current/);
});

test("a click on another line gets 'Not quite' and the right line is highlighted", async ({
  page,
}) => {
  await startTour(page);
  await speaksNext(page, "What does save return?");
  await skipChip(page).click();
  await speaksNext(page, "Save returns the clip.");
  await expect(page.getByText("Investigate:")).toBeVisible();
  await finishSpeech(page);

  await page.locator(".cm-line").nth(0).click();

  await expect.poll(() => spoken(page)).toContain("Not quite, it's here.");
  await expect(page.locator(".cm-line").nth(2)).toHaveClass(/cm-highlight-current/);
});

test("after investigate the modify prompt gets the explain-back chip, and skipping it tells the server", async ({
  page,
}) => {
  const skipped = bodiesPostedTo(page, "/api/skipped");
  await startTour(page);
  await speaksNext(page, "What does save return?");
  await skipChip(page).click();
  await speaksNext(page, "Save returns the clip.");
  await expect(page.getByText("Investigate:")).toBeVisible();
  await expect(page.getByText("Explain back: clip saving")).toBeHidden();
  await skipChip(page).click();
  expect(skipped).toEqual([]);

  await expect(page.getByText(checkQuestion)).toBeVisible();
  await speaksNext(page, "Click the line that returns the clip.");
  await speaksNext(page, checkQuestion);
  await expect(page.getByText("Explain back: clip saving")).toBeVisible();

  await skipChip(page).click();

  await expect.poll(() => skipped).toEqual([{ tour: "How are clips saved?" }]);
  await expect(skipChip(page)).toBeHidden();
});
