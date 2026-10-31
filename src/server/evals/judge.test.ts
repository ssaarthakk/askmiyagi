import { describe, expect, it } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { gradeLines } from "../../../test/eval-helpers.ts";
import type { EvalCase } from "../../shared/eval-suite.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Tour } from "../../shared/tour.ts";
import { judgeRun } from "./judge.ts";

const evalCase: EvalCase = {
  question: "How does ClipService.save work?",
  intent: "understand saving",
  mustHighlight: [],
  expectedOrder: [],
  keyFacts: [],
};

const tour: Tour = {
  question: evalCase.question,
  steps: [saveStep],
  checkQuestion: "What does save return?",
};

const ranges = [[{ file: "src/clip-service.ts", start: 2, end: 4, capped: false }]];

function judge(events: ProviderEvent[], seen: LLMRequest[] = [], judged: Tour = tour) {
  return judgeRun({
    provider: scripted(events, seen),
    root,
    evalCase,
    tour: judged,
    ranges,
    signal: new AbortController().signal,
  });
}

describe("judgeRun", () => {
  it("returns the four grades from the judge's reply", async () => {
    expect(await judge(gradeLines)).toEqual({
      ok: true,
      value: { correctness: 5, clarity: 4, questionQuality: 3, intentFit: 2 },
    });
  });

  it("sends a plain completion request with the rubric, the learner level and the intent", async () => {
    const seen: LLMRequest[] = [];
    await judge(gradeLines, seen);
    const [request] = seen;
    expect(request?.tools).toBe(false);
    expect(request?.system).toMatch(/intermediate/);
    for (const dimension of ["correctness", "clarity", "questionQuality", "intentFit"]) {
      expect(request?.system).toContain(dimension);
    }
    expect(request?.question).toContain("understand saving");
    expect(request?.question).toContain("How does ClipService.save work?");
  });

  it("shows the judge the tour and the highlighted code as untrusted blocks", async () => {
    const seen: LLMRequest[] = [];
    await judge(gradeLines, seen);
    const [request] = seen;
    expect(request?.question).toContain("<untrusted_content");
    expect(request?.question).toContain("Clips are saved here.");
    expect(request?.question).toContain("What does save return?");
    expect(request?.context).toContain("<untrusted_content");
    expect(request?.context).toContain("save(clip: string)");
  });

  it("shows a plain reply to the judge", async () => {
    const seen: LLMRequest[] = [];
    await judge(gradeLines, seen, {
      question: evalCase.question,
      steps: [],
      reply: "Glad to help.",
    });
    expect(seen[0]?.question).toContain("Glad to help.");
  });

  it("redacts secrets before anything is sent", async () => {
    const seen: LLMRequest[] = [];
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    await judge(gradeLines, seen, {
      question: evalCase.question,
      steps: [{ ...saveStep, narration: [{ text: `The key is ${key}` }] }],
    });
    expect(JSON.stringify(seen)).not.toContain(key);
  });

  it.each([
    [
      "a grade is missing",
      gradeLines.filter((event) => !(event.type === "text" && event.text.startsWith("clarity"))),
    ],
    [
      "a grade is above 5",
      gradeLines.map((event) =>
        event.type === "text" && event.text.startsWith("clarity")
          ? { ...event, text: "clarity: 6" }
          : event,
      ),
    ],
    [
      "a grade is not a whole number",
      gradeLines.map((event) =>
        event.type === "text" && event.text.startsWith("clarity")
          ? { ...event, text: "clarity: 3.5" }
          : event,
      ),
    ],
    ["the judge says nothing", [{ type: "done" as const, usage }]],
  ])("fails with the problem when %s", async (_name, events) => {
    const result = await judge(events);
    expect(result.ok).toBe(false);
  });

  it("fails with the provider's message on an error event", async () => {
    const result = await judge([{ type: "error", message: "boom", retryable: false }]);
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
