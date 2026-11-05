import { describe, expect, it } from "vitest";
import { formatTimeLeft, interviewHighlight } from "./interview.ts";

describe("formatTimeLeft", () => {
  it.each([
    [20 * 60 * 1000, "20:00"],
    [19 * 60 * 1000 + 42_000, "19:42"],
    [61_001, "1:02"],
    [9_000, "0:09"],
    [0, "0:00"],
    [-5_000, "0:00"],
  ])("shows %i ms as %s", (ms, text) => {
    expect(formatTimeLeft(ms)).toBe(text);
  });
});

describe("interviewHighlight", () => {
  const range = { file: "src/store.ts", start: 3, end: 5, capped: false };

  it("shows a drill in the diff view, with the real file on the old side", () => {
    expect(interviewHighlight({ kind: "drill", range })).toEqual({
      file: "src/store.ts",
      current: range,
      previous: null,
      base: "drill",
    });
  });

  it.each(["explain", "why"] as const)("shows a %s question in the plain viewer", (kind) => {
    expect(interviewHighlight({ kind, range })).toEqual({
      file: "src/store.ts",
      current: range,
      previous: null,
    });
  });
});
