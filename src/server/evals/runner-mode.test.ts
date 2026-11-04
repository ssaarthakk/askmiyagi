import { describe, expect, it } from "vitest";
import { saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { gradeLines } from "../../../test/eval-helpers.ts";
import type { EvalSuite } from "../../shared/eval-suite.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { runSuite } from "./runner.ts";

const evalSuite: EvalSuite = {
  repo: "test/fixtures/basic",
  cases: [
    {
      question: "How does ClipService.save work?",
      intent: "understand saving",
      mustHighlight: ["src/clip-service.ts#ClipService.save"],
      expectedOrder: ["src/clip-service.ts#ClipService.save"],
      keyFacts: ["saved"],
    },
  ],
};

const quiet: ProviderEvent[] = [
  { type: "step", step: saveStep },
  { type: "done", usage },
];

const withQuestion: ProviderEvent[] = [
  { type: "step", step: saveStep },
  { type: "checkQuestion", text: "Why?" },
  { type: "done", usage },
];

async function runIn(mode?: Profile["mode"], events = withQuestion) {
  const seen: LLMRequest[] = [];
  const result = await runSuite({
    suiteName: "unit",
    evalSuite,
    provider: scripted(events, seen),
    providerName: "fake",
    runs: 1,
    mode,
  });
  if (!result.ok) throw new Error(result.error);
  return {
    system: seen[0]?.system,
    question: seen[0]?.question,
    checks: result.value.cases[0]?.runs[0]?.checks,
  };
}

describe("runSuite mode", () => {
  it("asks in teach mode by default and accepts a check question", async () => {
    const taught = await runIn();

    expect(taught.system).not.toContain("Answer mode");
    expect(taught.checks?.questionsOnlyAtEnd).toBe(true);
  });

  it("allows a check question and a primm step in every teach-mode case", async () => {
    const taught = await runIn();

    expect(taught.question).toContain("You may end this answer with one check question");
  });

  it("asks in answer mode and fails a model that still returns a check question", async () => {
    const answered = await runIn("answer");

    expect(answered.system).toContain("Answer mode");
    expect(answered.checks?.questionsOnlyAtEnd).toBe(false);
  });

  it("passes a model that returns no question in answer mode", async () => {
    expect((await runIn("answer", quiet)).checks?.questionsOnlyAtEnd).toBe(true);
  });
});

describe("runSuite with a primm step", () => {
  const primmSuite: EvalSuite = {
    ...evalSuite,
    cases: [
      {
        question: "How does a clip get uploaded?",
        intent: "understand uploading",
        mustHighlight: ["src/upload.ts#uploadClip"],
        expectedOrder: ["src/upload.ts#uploadClip"],
        keyFacts: ["saved"],
      },
    ],
  };

  const primmEvents: ProviderEvent[] = [
    {
      type: "step",
      step: {
        ...saveStep,
        primm: {
          predict: "What comes back?",
          investigate: "Click where the path is returned.",
          target: { file: "src/upload.ts", symbol: "uploadClip" },
        },
      },
    },
    { type: "checkQuestion", text: "Why?", concept: "saving" },
    { type: "done", usage },
  ];

  async function runPrimm() {
    const seen: LLMRequest[] = [];
    const provider: LLMProvider = {
      async *ask(request, signal) {
        seen.push(request);
        yield* scripted(request.tools ? primmEvents : gradeLines).ask(request, signal);
      },
    };
    const result = await runSuite({
      suiteName: "unit",
      evalSuite: primmSuite,
      provider,
      providerName: "fake",
      runs: 1,
      judge: true,
    });
    if (!result.ok) throw new Error(result.error);
    return {
      checks: result.value.cases[0]?.runs[0]?.checks,
      judgeContext: seen.find((request) => !request.tools)?.context,
    };
  }

  it("does not count the investigate target as a highlight", async () => {
    const { checks } = await runPrimm();

    expect(checks?.highlights).toBe(false);
    expect(checks?.startingPoint).toBe(false);
    expect(checks?.flowOrder).toBe(false);
  });

  it("does not show the judge the investigate target as highlighted code", async () => {
    const { judgeContext } = await runPrimm();

    expect(judgeContext).toContain("src/clip-service.ts");
    expect(judgeContext).not.toContain("src/upload.ts");
  });
});
