import { describe, expect, it } from "vitest";
import { root, scripted, usage } from "../../../test/ask-helpers.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import { createGrader } from "./grader.ts";
import { createPredictor } from "./predictor.ts";
import type { LLMProvider } from "./provider.ts";
import { createRubricWriter } from "./rubric.ts";
import { createSummariser } from "./summariser.ts";
import type { CallLog } from "./tools-off-call.ts";

const fullUsage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 30,
  cacheWriteTokens: 40,
  costUsd: 0.05,
};

const grade = JSON.stringify({ score: 4, gaps: [], anchors: [], modelAnswer: "Retried." });

function logging(events: ProviderEvent[], provider: LLMProvider = scripted(events)) {
  const records: CallRecord[] = [];
  const callLog: CallLog = {
    provider: "fake",
    write: async (record) => {
      records.push(record);
    },
  };
  return { provider, callLog, records };
}

const calls = [
  {
    callType: "summary",
    text: "They asked about clips.",
    run: (log: ReturnType<typeof logging>) =>
      createSummariser(log.provider, root, log.callLog)("turns"),
  },
  {
    callType: "rubric",
    text: "Says the upload is retried.",
    run: (log: ReturnType<typeof logging>) =>
      createRubricWriter(log.provider, root, log.callLog)({ concept: "Retries", context: "code" }),
  },
  {
    callType: "prediction",
    text: "Close, it returns the id.",
    run: (log: ReturnType<typeof logging>) =>
      createPredictor(
        log.provider,
        root,
        log.callLog,
      )({ predict: "What returns?", narration: ["It returns."], prediction: "An id" }),
  },
  {
    callType: "grade",
    text: grade,
    run: (log: ReturnType<typeof logging>) =>
      createGrader(
        log.provider,
        root,
        log.callLog,
      )({ concept: "Retries", rubric: null, context: "", answer: "It retries." }),
  },
] as const;

describe.each(calls)("the $callType call", ({ callType, text, run }) => {
  it("is logged with its call type, provider and usage", async () => {
    const log = logging([
      { type: "text", text },
      { type: "done", usage: fullUsage },
    ]);

    expect((await run(log)).ok).toBe(true);

    expect(log.records).toEqual([
      {
        callType,
        provider: "fake",
        mode: null,
        startedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        ackMs: 0,
        firstContentMs: null,
        ...fullUsage,
        filesOpened: [],
        outcome: "done",
      },
    ]);
  });

  it("is logged as an error with the usage as zeros when the provider fails", async () => {
    const log = logging([{ type: "error", message: "Rate limited", retryable: true }]);

    expect((await run(log)).ok).toBe(false);

    expect(log.records).toHaveLength(1);
    expect(log.records[0]).toMatchObject({
      callType,
      outcome: "error",
      inputTokens: 0,
      costUsd: null,
    });
  });

  it("is logged as an error when the provider throws", async () => {
    const throwing = {
      async *ask() {
        yield* [];
        throw new Error("Claude Code was not found.");
      },
    };
    const log = logging([], throwing);

    await expect(run(log)).rejects.toThrow("not found");

    expect(log.records[0]).toMatchObject({ callType, outcome: "error" });
  });
});

describe("a tools-off call without a call log", () => {
  it("still runs", async () => {
    const provider = scripted([
      { type: "text", text: "They asked about clips." },
      { type: "done", usage },
    ]);

    expect(await createSummariser(provider, root)("turns")).toEqual({
      ok: true,
      value: "They asked about clips.",
    });
  });
});
