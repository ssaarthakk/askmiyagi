import { expect, test } from "@playwright/test";
import { bodiesPostedTo } from "./ask.ts";
import {
  finishInterview,
  first,
  held,
  interviewCard,
  lastAnswer,
  panel,
  routeInterview,
  sendAnswer,
  startInterview,
} from "./interview.ts";

test("Mock interview opens the setup, and Start asks the first question", async ({ page }) => {
  await routeInterview(page);
  await page.goto("/");
  const started = bodiesPostedTo(page, "/api/interview");

  await panel(page).getByRole("button", { name: "Mock interview" }).click();

  const setup = interviewCard(page);
  await expect(setup.getByRole("radio", { name: "Realistic" })).toBeChecked();
  await setup.getByRole("radio", { name: "Tough" }).check();
  await setup.getByRole("button", { name: "Start" }).click();

  await expect.poll(() => started).toEqual([{ difficulty: "tough" }]);
  await expect(setup.getByText("Question 1 of 6")).toBeVisible();
  await expect(setup.getByText("How are clips saved?")).toBeVisible();
});

test("an answer gets the interviewer's follow-up, and then the next question", async ({ page }) => {
  await routeInterview(page);
  const answers = bodiesPostedTo(page, "/api/interview/answer");
  const interview = await startInterview(page);

  await sendAnswer(page, "It writes the clip to disk.");

  await expect(interview.getByText("Can you say more?")).toBeVisible();
  await expect(interview.getByText("Question 1 of 6")).toBeVisible();

  await sendAnswer(page, "It also names the file.");

  await expect
    .poll(() => answers)
    .toEqual([{ answer: "It writes the clip to disk." }, { answer: "It also names the file." }]);
  await expect(interview.getByText("Question 2 of 6")).toBeVisible();
  await expect(interview.getByText("How does an upload work?")).toBeVisible();
});

test("Stop ends the interview and returns to the normal panel", async ({ page }) => {
  const stopped = await routeInterview(page);
  const interview = await startInterview(page);
  await expect(interview.getByText("Question 1 of 6")).toBeVisible();

  await interview.getByRole("button", { name: "Stop" }).click();

  await expect.poll(() => stopped).toEqual(["DELETE"]);
  await expect(interview).toBeHidden();
  await expect(panel(page).getByLabel("Question", { exact: true })).toBeVisible();
});

test("closing while the questions are planned stops the interview and keeps the card closed", async ({
  page,
}) => {
  const planning = held();
  const stopped = await routeInterview(page, {
    start: async (route) => {
      await planning.until;
      await route.fulfill({ json: first });
    },
  });
  const interview = await startInterview(page);

  await interview.getByRole("button", { name: "Close" }).click();
  planning.release();

  await expect.poll(() => stopped).toEqual(["DELETE"]);
  await expect(interview).toBeHidden();
  await expect(panel(page).getByText("How are clips saved?")).toBeHidden();
});

test("Mock interview during a running interview stops it and opens a fresh setup", async ({
  page,
}) => {
  const stopped = await routeInterview(page);
  const interview = await startInterview(page);
  await expect(interview.getByText("Question 1 of 6")).toBeVisible();

  await panel(page).getByRole("button", { name: "Mock interview" }).click();

  await expect.poll(() => stopped).toEqual(["DELETE"]);
  await expect(interview.getByRole("button", { name: "Start" })).toBeVisible();
});

test("a plan that fails shows the reason and lets the learner start again", async ({ page }) => {
  await routeInterview(page, {
    start: (route) =>
      route.fulfill({
        status: 502,
        json: { error: "The interviewer could only come up with 2 usable questions." },
      }),
  });

  const interview = await startInterview(page);

  await expect(
    interview.getByText("The interviewer could only come up with 2 usable questions."),
  ).toBeVisible();
  await expect(interview.getByRole("button", { name: "Start" })).toBeEnabled();
});

test("a timer shows the time left", async ({ page }) => {
  await routeInterview(page);

  const interview = await startInterview(page);

  await expect(interview.getByRole("timer")).toHaveText(/Time left (20:00|19:\d\d)/);
});

test("a timer that has run out says the time is up", async ({ page }) => {
  await routeInterview(page, {
    start: (route) => route.fulfill({ json: { ...first, endsAt: Date.now() - 1000 } }),
  });

  const interview = await startInterview(page);

  await expect(interview.getByRole("timer")).toHaveText("Time is up. Finish your answer.");
});

test("the answer that ends the interview says so", async ({ page }) => {
  await routeInterview(page, { replies: lastAnswer });

  const interview = await finishInterview(page);

  await expect(interview.getByText("That's time. Thank you.")).toBeVisible();
  await expect(interview.getByText("That was the last question.")).toBeVisible();
  await expect(interview.getByRole("timer")).toBeHidden();
});

test("voice-only hides the code until the interview is over", async ({ page }) => {
  await routeInterview(page, { replies: lastAnswer });
  await page.goto("/?interview=1");
  const interview = interviewCard(page);
  const code = page.getByRole("region", { name: "Code" });
  await interview.getByRole("checkbox", { name: "Voice-only" }).check();

  await interview.getByRole("button", { name: "Start" }).click();

  await expect(interview.getByText("Question 1 of 6")).toBeVisible();
  await expect(code).toBeHidden();

  await sendAnswer(page, "My last answer.");

  await expect(code).toBeVisible();
});

test("without voice-only the code stays visible during the interview", async ({ page }) => {
  await routeInterview(page);

  const interview = await startInterview(page);

  await expect(interview.getByText("Question 1 of 6")).toBeVisible();
  await expect(page.getByRole("region", { name: "Code" })).toBeVisible();
});

test("leaving the page ends the interview", async ({ page }) => {
  const stopped = await routeInterview(page);
  const interview = await startInterview(page);
  await expect(interview.getByText("Question 1 of 6")).toBeVisible();

  await page.evaluate("window.dispatchEvent(new Event('pagehide'))");

  await expect.poll(() => stopped).toEqual(["DELETE"]);
});
