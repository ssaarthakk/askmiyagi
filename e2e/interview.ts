import type { Page, Route } from "@playwright/test";
import { stubProfile } from "./ask.ts";
import { stubSpeaker } from "./speaker-stub.ts";

const twentyMinutes = 20 * 60 * 1000;
export const first = {
  endsAt: Date.now() + twentyMinutes,
  number: 1,
  total: 6,
  kind: "explain",
  concept: "Clips",
  question: "How are clips saved?",
  range: { file: "src/clip-service.ts", start: 1, end: 3, capped: false },
};
export const scorecard = {
  overall: 3.8,
  weak: ["Clips"],
  questions: [
    {
      number: 1,
      kind: "explain",
      concept: "Clips",
      question: "How are clips saved?",
      scores: { accuracy: 5, reasoning: 4, depth: 2, clarity: 4 },
      gaps: ["You did not say what happens when the disk is full."],
      ranges: [{ file: "src/clip-service.ts", start: 2, end: 3, capped: false }],
      modelAnswer: "It writes the clip to disk and returns it.",
    },
  ],
};
const second = {
  ...first,
  number: 2,
  concept: "Uploads",
  question: "How does an upload work?",
};
const probeThenNext = [
  { action: "probe", say: "Can you say more?", next: null, finished: false },
  { action: "next", say: "Thanks.", next: second, finished: false },
];
export const lastAnswer = [
  { action: "next", say: "That's time. Thank you.", next: null, finished: true },
];

export async function routeInterview(
  page: Page,
  options: {
    start?: (route: Route) => Promise<void>;
    replies?: object[];
    debrief?: (route: Route) => Promise<void>;
    speaker?: boolean;
  } = {},
) {
  await page.addInitScript(options.speaker ? stubSpeaker : "speechSynthesis.getVoices = () => [];");
  await stubProfile(page);
  const stopped: string[] = [];
  await page.route("**/api/interview", (route) => {
    if (route.request().method() !== "DELETE") {
      return options.start ? options.start(route) : route.fulfill({ json: first });
    }
    stopped.push("DELETE");
    return route.fulfill({ status: 204 });
  });
  const replies = [...(options.replies ?? probeThenNext)];
  await page.route("**/api/interview/answer", (route) => route.fulfill({ json: replies.shift() }));
  await page.route(
    "**/api/interview/debrief",
    options.debrief ?? ((route) => route.fulfill({ json: scorecard })),
  );
  return stopped;
}

export const panel = (page: Page) =>
  page.getByRole("complementary", { name: "Conversation panel" });
export const interviewCard = (page: Page) =>
  panel(page).getByRole("region", { name: "Mock interview" });
const answerBox = (page: Page) => panel(page).getByLabel("Your answer");

export async function startInterview(page: Page) {
  await page.goto("/?interview=1");
  await interviewCard(page).getByRole("button", { name: "Start" }).click();
  return interviewCard(page);
}

export async function sendAnswer(page: Page, text: string) {
  await answerBox(page).fill(text);
  await answerBox(page).press("Enter");
}

export async function finishInterview(page: Page) {
  const interview = await startInterview(page);
  await sendAnswer(page, "My last answer.");
  return interview;
}

export function held() {
  let release: () => void = () => {};
  const until = new Promise<void>((resolve) => (release = resolve));
  return { release, until };
}
