import { describe, expect, it } from "vitest";
import { usage } from "../../../test/ask-helpers.ts";
import { lineWith, resultOf } from "../../../test/eval-helpers.ts";
import { formatCalibration, humanGradesSchema } from "./calibrate.ts";

function grades(correctness: number, clarity: number) {
  return { correctness, clarity, questionQuality: 3, intentFit: 3 };
}

const result = resultOf([
  {
    question: "First?",
    runs: [
      { checks: {}, grades: grades(5, 5), usage, durationMs: 1 },
      { checks: {}, grades: grades(4, 1), usage, durationMs: 1 },
    ],
  },
  {
    question: "Second?",
    runs: [
      { checks: {}, grades: grades(1, 3), usage, durationMs: 1 },
      { checks: {}, usage, durationMs: 1 },
    ],
  },
]);

describe("formatCalibration", () => {
  it("compares each human grade with the judge's grade for every graded run of the case", () => {
    const humans = [
      { case: 0, ...grades(5, 3) },
      { case: 1, ...grades(3, 3) },
    ];
    const output = formatCalibration(result, humans);
    expect(lineWith(output, "correctness")).toMatch(/1\/3\s+2\/3/);
    expect(lineWith(output, "clarity")).toMatch(/1\/3\s+1\/3/);
    expect(lineWith(output, "questionQuality")).toMatch(/3\/3\s+3\/3/);
  });

  it("counts a grade within 1 as a near match", () => {
    const output = formatCalibration(result, [{ case: 0, ...grades(4, 2) }]);
    expect(lineWith(output, "correctness")).toMatch(/1\/2\s+2\/2/);
    expect(lineWith(output, "clarity")).toMatch(/0\/2\s+1\/2/);
  });

  it("says so when no compared run has a judge grade", () => {
    const output = formatCalibration(
      { ...result, cases: [{ question: "Q", runs: [{ checks: {}, usage, durationMs: 1 }] }] },
      [{ case: 0, ...grades(5, 5) }],
    );
    expect(output).toContain("No judge grades");
  });

  it("rejects a human grade for a case the result does not have", () => {
    expect(() => formatCalibration(result, [{ case: 2, ...grades(5, 5) }])).toThrow("no case 2");
  });
});

describe("humanGradesSchema", () => {
  it("accepts the grades file shape", () => {
    expect(humanGradesSchema.safeParse([{ case: 0, ...grades(5, 5) }])).toMatchObject({
      success: true,
      data: [{ case: 0, ...grades(5, 5) }],
    });
  });

  it.each([
    [[{ case: 0, ...grades(6, 5) }]],
    [[{ case: -1, ...grades(5, 5) }]],
    [[{ ...grades(5, 5) }]],
    [{}],
  ])("rejects %j", (json) => {
    expect(humanGradesSchema.safeParse(json).success).toBe(false);
  });
});
