import { describe, expect, it } from "vitest";
import { saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import type { EvalSuite } from "../../shared/eval-suite.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
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
  return { system: seen[0]?.system, checks: result.value.cases[0]?.runs[0]?.checks };
}

describe("runSuite mode", () => {
  it("asks in teach mode by default and accepts a check question", async () => {
    const taught = await runIn();

    expect(taught.system).not.toContain("Answer mode");
    expect(taught.checks?.questionsOnlyAtEnd).toBe(true);
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
