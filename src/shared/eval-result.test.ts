import { describe, expect, it } from "vitest";
import { evalResultSchema } from "./eval-result.ts";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

function result(run: Record<string, unknown> = {}) {
  return {
    suite: "fixtures",
    provider: "fake",
    runs: 1,
    startedAt: "2026-10-31T12:00:00.000Z",
    cases: [
      {
        question: "Q",
        runs: [{ checks: { validJson: true, latencyMs: 12 }, usage, durationMs: 12, ...run }],
      },
    ],
  };
}

describe("evalResultSchema", () => {
  it("accepts a result with checks, usage and no grades", () => {
    expect(evalResultSchema.safeParse(result()).success).toBe(true);
  });

  it("accepts grades from 1 to 5", () => {
    const grades = { correctness: 5, clarity: 4, questionQuality: 1, intentFit: 3 };
    expect(evalResultSchema.safeParse(result({ grades })).success).toBe(true);
  });

  it.each([0, 6, 2.5])("rejects a grade of %s", (bad) => {
    const grades = { correctness: bad, clarity: 4, questionQuality: 1, intentFit: 3 };
    expect(evalResultSchema.safeParse(result({ grades })).success).toBe(false);
  });

  it("rejects a check that is neither a boolean nor a number", () => {
    expect(evalResultSchema.safeParse(result({ checks: { validJson: "yes" } })).success).toBe(
      false,
    );
  });

  it("rejects a result without a valid start time", () => {
    expect(evalResultSchema.safeParse({ ...result(), startedAt: "yesterday" }).success).toBe(false);
  });
});
