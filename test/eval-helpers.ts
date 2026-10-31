import { resolve } from "node:path";
import { type EvalRun, runCodeChecks } from "../src/server/evals/code-checks.ts";
import type { ResolvedAnchor } from "../src/shared/anchor.ts";
import type { EvalResult } from "../src/shared/eval-result.ts";
import type { AskEvent, ProviderEvent } from "../src/shared/events.ts";
import type { Step } from "../src/shared/tour.ts";
import { usage } from "./ask-helpers.ts";

const root = resolve(import.meta.dirname, "fixtures/basic");

export const uploadClip: ResolvedAnchor = {
  file: "src/upload.ts",
  start: 1,
  end: 3,
  capped: false,
};
export const save: ResolvedAnchor = {
  file: "src/clip-service.ts",
  start: 2,
  end: 4,
  capped: false,
};
export const readme: ResolvedAnchor = { file: "README.md", start: 1, end: 2, capped: false };

type StepInput = { range: ResolvedAnchor | null; narration?: string[] };

export function step({
  range,
  narration = ["It saves the clip."],
}: StepInput): [Step, ResolvedAnchor | null] {
  return [
    {
      title: "A step",
      anchors: [{ file: range?.file ?? "src/missing.ts", symbol: "thing" }],
      narration: narration.map((text) => ({ text })),
    },
    range,
  ];
}

export function run(
  steps: StepInput[],
  extras: { checkQuestion?: string; reply?: string; filesOpened?: string[] } = {},
  overrides: Partial<EvalRun> = {},
): EvalRun {
  const built = steps.map(step);
  const events: AskEvent[] = [
    { type: "ack", text: "Okay." },
    {
      type: "tour",
      tour: {
        question: "Q",
        steps: built.map(([item]) => item),
        ...(extras.checkQuestion === undefined ? {} : { checkQuestion: extras.checkQuestion }),
        ...(extras.reply === undefined ? {} : { reply: extras.reply }),
      },
      ranges: built.map(([, range]) => [range]),
    },
    { type: "done" },
  ];
  return {
    events,
    filesOpened: extras.filesOpened ?? [],
    toolCalls: 2,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.02,
    },
    durationMs: 1200,
    ...overrides,
  };
}

const testCase = {
  question: "How does a clip get saved?",
  intent: "understand the save flow",
  mustHighlight: ["src/upload.ts#uploadClip"],
  expectedOrder: ["src/upload.ts#uploadClip", "src/clip-service.ts#ClipService.save"],
  keyFacts: ["clip"],
};

export function check(evalRun: EvalRun, overrides: Partial<typeof testCase> = {}) {
  return runCodeChecks(root, { ...testCase, ...overrides }, evalRun);
}

export const gradeLines: ProviderEvent[] = [
  { type: "text", text: "correctness: 5" },
  { type: "text", text: "clarity: 4" },
  { type: "text", text: "questionQuality: 3" },
  { type: "text", text: "intentFit: 2" },
  { type: "done", usage },
];

export function resultOf(cases: EvalResult["cases"]): EvalResult {
  return {
    suite: "fixtures",
    provider: "fake",
    runs: Math.max(...cases.map((item) => item.runs.length)),
    startedAt: "2026-10-31T12:00:00.000Z",
    cases,
  };
}

export function lineWith(text: string, word: string) {
  const line = text.split("\n").find((candidate) => candidate.includes(word));
  if (!line) throw new Error(`no line with ${word} in\n${text}`);
  return line;
}
