import { describe, expect, it } from "vitest";
import { usage } from "../../../test/ask-helpers.ts";
import { lineWith, resultOf } from "../../../test/eval-helpers.ts";
import { formatComparison, formatScores } from "./score-table.ts";

function resultOfChecks(...runs: Record<string, boolean | number>[]) {
  return resultOf([
    {
      question: "How does a clip get uploaded?",
      runs: runs.map((checks) => ({ checks, usage, durationMs: 1 })),
    },
  ]);
}

describe("formatScores", () => {
  const table = formatScores(
    resultOfChecks(
      { highlights: true, latencyMs: 100, costUsd: 0.5 },
      { highlights: false, latencyMs: 300 },
      { highlights: true, latencyMs: 200, costUsd: 0.1 },
    ),
  );

  it("shows the case question and a column for every check", () => {
    expect(table).toContain("How does a clip get uploaded?");
    for (const name of ["highlights", "latencyMs", "costUsd"]) expect(table).toContain(name);
  });

  it("shows the pass rate of a pass or fail check", () => {
    expect(lineWith(table, "How does")).toContain("67%");
  });

  it("shows the average of a reported number, over the runs that reported it", () => {
    const row = lineWith(table, "How does");
    expect(row).toContain("200");
    expect(row).toContain("0.3");
  });

  it("always shows a cost column, with - when the provider reports no cost", () => {
    const noCost = formatScores(resultOfChecks({ highlights: true }));
    expect(noCost).toContain("costUsd");
    expect(lineWith(noCost, "How does")).toMatch(/100%\s+-/);
  });
});

describe("formatScores failure labels", () => {
  const failures = [
    { failure: "retrieval-miss" as const },
    { failure: "reasoning-miss" as const },
    { failure: "reasoning-miss" as const },
    {},
  ];
  const result = resultOfChecks(...failures.map(() => ({ highlights: true })));
  const first = result.cases[0];
  if (!first) throw new Error("no case");
  first.runs = first.runs.map((run, index) => ({ ...run, ...failures[index] }));
  const table = formatScores(result);

  it("counts the retrieval and reasoning misses of each case", () => {
    expect(table).toContain("retrieval-miss");
    expect(table).toContain("reasoning-miss");
    const [header = "", row = ""] = table.split("\n").slice(1);
    const columns = (line: string) => line.trim().split(/\s{2,}/);
    const at = (name: string) => columns(row)[columns(header).indexOf(name)];
    expect(at("retrieval-miss")).toBe("1");
    expect(at("reasoning-miss")).toBe("2");
  });

  it("shows zero misses for a case with no failures", () => {
    const clean = formatScores(resultOfChecks({ highlights: true }));
    const [header = "", row = ""] = clean.split("\n").slice(1);
    expect(header).toContain("retrieval-miss");
    expect(row).toMatch(/0\s+0$/);
  });
});

describe("formatComparison", () => {
  const before = resultOfChecks({ highlights: true, flowOrder: false }, { highlights: false });
  const after = resultOfChecks({ highlights: true, flowOrder: false }, { highlights: true });

  it("shows each check's pass rate before, after and the change", () => {
    const row = lineWith(formatComparison(before, after), "highlights");
    expect(row).toContain("50%");
    expect(row).toContain("100%");
    expect(row).toContain("+50%");
  });

  it("shows a drop with a minus sign", () => {
    const row = lineWith(formatComparison(after, before), "highlights");
    expect(row).toContain("-50%");
  });

  it("shows the change of a reported number", () => {
    const slow = resultOfChecks({ latencyMs: 300 });
    const fast = resultOfChecks({ latencyMs: 100 });
    expect(lineWith(formatComparison(slow, fast), "latencyMs")).toContain("-200");
  });

  it("shows a dash for a check only one result has", () => {
    const extra = resultOfChecks({ highlights: true, costUsd: 1 });
    expect(lineWith(formatComparison(before, extra), "costUsd")).toMatch(/-\s+1\s+-/);
  });
});

describe("judge grades", () => {
  const graded = resultOf([
    {
      question: "How does a clip get uploaded?",
      runs: [
        {
          checks: { highlights: true },
          grades: { correctness: 5, clarity: 4, questionQuality: 3, intentFit: 2 },
          usage,
          durationMs: 1,
        },
        {
          checks: { highlights: true },
          grades: { correctness: 3, clarity: 4, questionQuality: 3, intentFit: 2 },
          usage,
          durationMs: 1,
        },
      ],
    },
  ]);

  it("shows the average grade per dimension in the score table", () => {
    const table = formatScores(graded);
    expect(lineWith(table, "correctness")).toContain("intentFit");
    expect(lineWith(table, "How does")).toMatch(/100%\s+-\s+4\s+4\s+3\s+2\s+0\s+0$/);
  });

  it("compares the average grades", () => {
    expect(lineWith(formatComparison(graded, graded), "correctness")).toMatch(/4\s+4\s+0/);
  });
});
