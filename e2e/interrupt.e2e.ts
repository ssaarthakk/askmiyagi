import { expect, type Page, test } from "@playwright/test";
import type { Tour } from "../src/shared/tour.ts";
import { ask } from "./ask.ts";
import { holdMicrophone, stubMicrophone } from "./microphone-stub.ts";
import {
  endAsk,
  finishSpeech,
  heldAsk,
  sendAskEvent,
  spoken,
  stepEvent,
  stubSpeaker,
  useElevenLabsVoice,
} from "./speaker-stub.ts";

const streamed = "Streamed one.";
const sideAnswer = "A clip is one recording.";

async function say(page: Page, transcript: string) {
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: transcript } }));
  await holdMicrophone(page);
}

async function finishAnswer(page: Page, scope?: Tour["scope"]) {
  const answer = stepEvent(sideAnswer);
  await sendAskEvent(page, answer);
  await sendAskEvent(page, {
    type: "tour",
    tour: { question: "What is a clip?", steps: [answer.step], ...(scope && { scope }) },
    ranges: [answer.ranges],
  });
  await sendAskEvent(page, { type: "done" });
  await endAsk(page);
}

async function open(page: Page, transcript: string) {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await page.addInitScript(heldAsk);
  await useElevenLabsVoice(page);
  await page.route("**/api/transcribe", (route) => route.fulfill({ json: { text: transcript } }));
  const interrupts: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/interrupt") interrupts.push(request.method());
  });
  return { interrupts, asked: () => page.evaluate<string[]>("window.askedQuestions") };
}

test("a spoken question during a streaming answer interrupts it, and the partial tour resumes after the side answer", async ({
  page,
}) => {
  const { interrupts, asked } = await open(page, "What is a clip?");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);

  await holdMicrophone(page);

  await expect.poll(asked).toEqual(["How are clips saved?", "What is a clip?"]);
  expect(interrupts).toEqual(["POST"]);
  await finishAnswer(page, "side");
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer]);

  await finishSpeech(page);

  await expect(page.getByText("Back to where we were")).toBeVisible();
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer, streamed]);
});

test("the late events of the interrupted answer are ignored", async ({ page }) => {
  const { asked } = await open(page, "What is a clip?");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);
  const lateStream = await page.evaluateHandle("window.sendAskEvent");

  await holdMicrophone(page);
  await expect.poll(asked).toEqual(["How are clips saved?", "What is a clip?"]);
  await page.evaluate(
    (send) => (send as (event: object) => void)({ type: "progress", text: "Too late" }),
    lateStream,
  );

  await expect(page.getByText("Too late")).toHaveCount(0);
});

test("after a new topic the earlier tour waits on the stack until the learner says resume", async ({
  page,
}) => {
  const { asked } = await open(page, "What is a clip?");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);
  await holdMicrophone(page);
  await expect.poll(asked).toHaveLength(2);

  await finishAnswer(page, "new");
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer]);
  await finishSpeech(page);
  await page.waitForTimeout(300);
  expect(await spoken(page)).toEqual([streamed, sideAnswer]);
  await expect(page.getByText("Back to where we were")).toHaveCount(0);

  await say(page, "Resume.");

  await expect(page.getByText("Back to where we were")).toBeVisible();
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer, streamed]);
  expect(await asked()).toHaveLength(2);
});

test("speaking interrupts the streaming answer to a spoken question", async ({ page }) => {
  const { interrupts, asked } = await open(page, "How are clips saved?");
  await page.goto("/");
  await holdMicrophone(page);
  await expect.poll(asked).toEqual(["How are clips saved?"]);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);

  await say(page, "What is a clip?");

  await expect.poll(asked).toEqual(["How are clips saved?", "What is a clip?"]);
  expect(interrupts).toEqual(["POST"]);
});

test("a partial tour whose narration had caught up still goes on the stack", async ({ page }) => {
  const { asked } = await open(page, "What is a clip?");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);
  await finishSpeech(page);

  await holdMicrophone(page);
  await expect.poll(asked).toHaveLength(2);
  await finishAnswer(page, "side");
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer]);
  await finishSpeech(page);

  await expect(page.getByText("Back to where we were")).toBeVisible();
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer, streamed]);
});

test("a side question during a new topic does not bring back the tour the new topic set aside", async ({
  page,
}) => {
  const { asked } = await open(page, "What is a clip?");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);
  await holdMicrophone(page);
  await expect.poll(asked).toHaveLength(2);
  await finishAnswer(page, "new");
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer]);

  await say(page, "Why?");
  await expect.poll(asked).toHaveLength(3);
  await finishAnswer(page, "side");
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer, sideAnswer]);
  await finishSpeech(page);
  await expect.poll(() => spoken(page)).toEqual([streamed, sideAnswer, sideAnswer, sideAnswer]);
  await finishSpeech(page);
  await page.waitForTimeout(300);

  expect(await spoken(page)).toEqual([streamed, sideAnswer, sideAnswer, sideAnswer]);
});

test("resume brings back the stacked tour after a reply that left no tour on screen", async ({
  page,
}) => {
  const { asked } = await open(page, "Tell me about the tests");
  await ask(page);
  await sendAskEvent(page, stepEvent(streamed));
  await expect.poll(() => spoken(page)).toEqual([streamed]);
  await holdMicrophone(page);
  await expect.poll(asked).toHaveLength(2);
  await sendAskEvent(page, {
    type: "tour",
    tour: {
      question: "Tell me about the tests",
      steps: [],
      reply: "There are none.",
      scope: "new",
    },
    ranges: [],
  });
  await sendAskEvent(page, { type: "done" });
  await endAsk(page);
  await expect.poll(() => spoken(page)).toEqual([streamed, "There are none."]);

  await say(page, "Resume.");

  await expect(page.getByText("Back to where we were")).toBeVisible();
  await expect.poll(() => spoken(page)).toEqual([streamed, "There are none.", streamed]);
  expect(await asked()).toHaveLength(2);
});
