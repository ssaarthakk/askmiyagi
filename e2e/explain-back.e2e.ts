import { expect, type Page, test } from "@playwright/test";
import { ask, bodiesPostedTo, countAsks, stubProfile } from "./ask.ts";
import { finishSpeech, spoken, stubSpeaker } from "./speaker-stub.ts";

const file = "src/clip-service.ts";
const step = {
  title: "Saving a clip",
  anchors: [{ file, symbol: "ClipService.save" }],
  narration: [{ text: "Save returns the clip.", anchor: 0 }],
};
const range = { file, start: 2, end: 4, capped: false };
const concept = "clip saving";
const endQuestion = `Explain ${concept} back to me in your own words.`;

async function startTour(page: Page, options: { question?: boolean; mode?: string } = {}) {
  const { question = true, mode } = options;
  await page.addInitScript(stubSpeaker);
  const events = [
    { type: "step", step, ranges: [range] },
    {
      type: "tour",
      tour: {
        question: "How are clips saved?",
        steps: [step],
        ...(question ? { checkQuestion: endQuestion, checkConcept: concept } : {}),
      },
      ranges: [[range]],
    },
    { type: "done" },
  ];
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    }),
  );
  await ask(page, mode);
}

test("the next message is graded as an explain-back instead of asked, and the tutor names the gaps", async ({
  page,
}) => {
  const graded = bodiesPostedTo(page, "/api/explain-back");
  const questions = countAsks(page);
  let replies = 0;
  await page.route("**/api/explain-back", (route) =>
    route.fulfill({
      json:
        replies++ === 0
          ? {
              outcome: "retry",
              score: 2,
              gaps: ["You did not say what it returns."],
              ranges: [range],
              modelAnswer: null,
            }
          : { outcome: "passed", score: 5, gaps: [], ranges: [], modelAnswer: null },
    }),
  );
  await startTour(page);
  await expect.poll(() => spoken(page)).toContain("Save returns the clip.");
  await expect(page.getByText(`Explain back: ${concept}`)).toBeHidden();
  await finishTourAndWaitForReport(page, ["Save returns the clip.", endQuestion]);
  await expect(page.getByText(`Explain back: ${concept}`)).toBeVisible();
  const box = page.getByLabel("Question");

  await box.fill("It saves a clip");
  await box.press("Enter");

  await expect.poll(() => graded).toEqual([{ concept, answer: "It saves a clip", review: false }]);
  await expect(
    page.getByText("Not quite yet. You did not say what it returns. Try again, or skip."),
  ).toBeVisible();
  await expect(page.getByText(`Explain back: ${concept}`)).toBeVisible();

  await box.fill("It returns the clip");
  await box.press("Enter");

  await expect(page.getByText(`That's a good explanation of ${concept}.`)).toBeVisible();
  await expect(page.getByText(`Explain back: ${concept}`)).toBeHidden();
  expect(questions).toEqual(["How are clips saved?"]);
});

test("the welcome pane offers the due reviews, and Start asks for the explanation", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { due: [concept] } }));
  const skipped = bodiesPostedTo(page, "/api/review-skipped");
  await stubProfile(page);
  await page.goto("/");
  await expect(page.getByText("1 review due")).toBeVisible();

  await page.getByRole("button", { name: "Start review" }).click();

  await expect(page.getByText(`Explain back: ${concept}`)).toBeVisible();
  await expect(page.getByText(endQuestion)).toBeVisible();
  await page.locator("form").getByRole("button", { name: "Skip" }).click();
  await expect.poll(() => skipped).toEqual([{ concept }]);
  await expect(page.getByText(`Explain back: ${concept}`)).toBeHidden();
});

const offer = (page: Page) => page.getByText(`A review is due: ${concept}. Want to try it now?`);

async function finishTourAndWaitForReport(page: Page, spokenLines = ["Save returns the clip."]) {
  const played = bodiesPostedTo(page, "/api/played");
  for (const line of spokenLines) {
    await expect.poll(() => spoken(page)).toContain(line);
    await finishSpeech(page);
  }
  await expect.poll(() => played).toHaveLength(1);
}

async function noOfferComes(page: Page) {
  await page.waitForTimeout(500);
  await expect(page.getByText("A review is due:")).toBeHidden();
}

test("a finished teach tour that asked no question offers the first due review in one bubble", async ({
  page,
}) => {
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { due: [concept, "x"] } }));
  await startTour(page, { question: false });
  await expect.poll(() => spoken(page)).toContain("Save returns the clip.");
  await noOfferComes(page);

  await finishTourAndWaitForReport(page);

  await expect(offer(page)).toBeVisible();
  await expect(page.getByText("A review is due:")).toHaveCount(1);
});

test("a tour that asked a question offers no review", async ({ page }) => {
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { due: [concept] } }));
  await startTour(page);

  await finishTourAndWaitForReport(page, ["Save returns the clip.", endQuestion]);

  await expect(page.getByText(`Explain back: ${concept}`)).toBeVisible();
  await noOfferComes(page);
});

test("answer mode shows no review count on the welcome pane and offers no review after a tour", async ({
  page,
}) => {
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { due: [concept] } }));
  await stubProfile(page, "answer");
  const loaded = page.waitForResponse("**/api/reviews");
  await page.goto("/");
  await loaded;
  await expect(page.getByLabel("Question")).toBeVisible();
  await expect(page.getByText("review due")).toBeHidden();

  await startTour(page, { question: false, mode: "answer" });
  await finishTourAndWaitForReport(page);

  await noOfferComes(page);
});
