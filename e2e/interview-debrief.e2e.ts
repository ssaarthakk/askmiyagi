import { expect, test } from "@playwright/test";
import { bodiesPostedTo } from "./ask.ts";
import {
  finishInterview,
  first,
  held,
  interviewCard,
  lastAnswer,
  routeInterview,
  scorecard,
  sendAnswer,
} from "./interview.ts";
import { announced } from "./speaker-stub.ts";

test("the last answer is followed by a scorecard with scores, gaps, model answers and weak topics", async ({
  page,
}) => {
  const grading = held();
  await routeInterview(page, {
    replies: lastAnswer,
    debrief: async (route) => {
      await grading.until;
      await route.fulfill({ json: scorecard });
    },
  });

  const interview = await finishInterview(page);

  await expect(interview.getByText("Grading your interview…")).toBeVisible();
  grading.release();
  const card = interview.getByRole("region", { name: "Scorecard" });
  await expect(card.getByText("Overall 3.8 out of 5")).toBeVisible();
  await expect(card.getByText("Weak topics: Clips")).toBeVisible();
  await expect(card.getByRole("heading", { name: "1. Clips" })).toBeVisible();
  for (const score of ["Accuracy 5", "Reasoning 4", "Depth 2", "Clarity 4"]) {
    await expect(card.getByText(score)).toBeVisible();
  }
  await expect(card.getByText("You did not say what happens when the disk is full.")).toBeVisible();
  await expect(card.getByText("It writes the clip to disk and returns it.")).toBeVisible();
  await expect(interview.getByText("Grading your interview…")).toBeHidden();
});

test("a gap shows its code in the code pane", async ({ page }) => {
  await routeInterview(page, { replies: lastAnswer });
  const interview = await finishInterview(page);

  await interview.getByRole("button", { name: "Show src/clip-service.ts:2" }).click();

  const lines = page.locator(".cm-line");
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(2)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(0)).not.toHaveClass(/cm-highlight/);
});

test("a debrief that fails shows the reason and can be tried again", async ({ page }) => {
  let calls = 0;
  await routeInterview(page, {
    replies: lastAnswer,
    debrief: (route) =>
      ++calls === 1
        ? route.fulfill({
            status: 502,
            json: { error: "The grader skipped question 1. Try again." },
          })
        : route.fulfill({ json: scorecard }),
  });
  const interview = await finishInterview(page);

  await expect(interview.getByText("The grader skipped question 1. Try again.")).toBeVisible();
  await interview.getByRole("button", { name: "Try again" }).click();

  await expect(interview.getByText("Overall 3.8 out of 5")).toBeVisible();
  await expect(interview.getByText("The grader skipped question 1. Try again.")).toBeHidden();
});

test("a whole friendly session is spoken question by question and ends on the scorecard", async ({
  page,
}) => {
  const concepts = ["Clips", "Uploads", "Retries", "Naming", "Storage", "Limits"];
  const questions = concepts.map((concept, index) => ({
    ...first,
    number: index + 1,
    kind: index === 5 ? "why" : "explain",
    concept,
    question: `Tell me about ${concept}.`,
  }));
  await routeInterview(page, {
    speaker: true,
    start: (route) => route.fulfill({ json: questions[0] }),
    replies: [
      { action: "probe", say: "Can you say more?", next: null, finished: false },
      ...questions
        .slice(1)
        .map((next) => ({ action: "next", say: "Thanks.", next, finished: false })),
      { action: "next", say: "That's the interview. Thank you.", next: null, finished: true },
    ],
    debrief: (route) =>
      route.fulfill({
        json: {
          overall: 3.5,
          weak: [],
          questions: questions.map(({ number, kind, concept, question }) => ({
            number,
            kind,
            concept,
            question,
            scores: { accuracy: 4, reasoning: 3, depth: 3, clarity: 4 },
            gaps: [],
            ranges: [],
            modelAnswer: `A good answer about ${concept}.`,
          })),
        },
      }),
  });
  const started = bodiesPostedTo(page, "/api/interview");
  await page.goto("/?interview=1");
  const interview = interviewCard(page);

  await interview.getByRole("radio", { name: "Friendly" }).check();
  await interview.getByRole("button", { name: "Start" }).click();
  await expect(interview.getByText("Question 1 of 6")).toBeVisible();
  await sendAnswer(page, "Answer 1.");
  await expect(interview.getByText("Can you say more?")).toBeVisible();
  for (let number = 2; number <= 6; number++) {
    await sendAnswer(page, `Answer ${number}.`);
    await expect(interview.getByText(`Question ${number} of 6`)).toBeVisible();
  }
  await sendAnswer(page, "Answer 7.");

  const card = interview.getByRole("region", { name: "Scorecard" });
  await expect(card.getByText("Overall 3.5 out of 5")).toBeVisible();
  await expect(card.getByRole("heading")).toHaveCount(6);
  await expect(card.getByText("A good answer about Limits.")).toBeVisible();
  expect(started).toEqual([{ difficulty: "friendly" }]);
  await expect
    .poll(() => announced(page))
    .toEqual([
      "Tell me about Clips.",
      "Can you say more?",
      ...concepts.slice(1).flatMap((concept) => ["Thanks.", `Tell me about ${concept}.`]),
      "That's the interview. Thank you.",
    ]);
});
