import { describe, expect, it } from "vitest";
import { moveHighlight } from "./highlight.ts";

describe("moveHighlight", () => {
  it("shows the first range with nothing dimmed", () => {
    expect(moveHighlight(undefined, "a.ts", { start: 2, end: 4 })).toEqual({
      file: "a.ts",
      current: { start: 2, end: 4 },
      previous: null,
    });
  });

  it("dims the previous range when moving within the same file", () => {
    const first = moveHighlight(undefined, "a.ts", { start: 2, end: 4 });

    expect(moveHighlight(first, "a.ts", { start: 8, end: 9 })).toEqual({
      file: "a.ts",
      current: { start: 8, end: 9 },
      previous: { start: 2, end: 4 },
    });
  });

  it("drops the previous range when the file changes", () => {
    const first = moveHighlight(undefined, "a.ts", { start: 2, end: 4 });

    expect(moveHighlight(first, "b.ts", { start: 1, end: 1 }).previous).toBeNull();
  });

  it("shows no highlight at all for a null range", () => {
    const first = moveHighlight(undefined, "a.ts", { start: 2, end: 4 });

    expect(moveHighlight(first, "a.ts", null)).toEqual({
      file: "a.ts",
      current: null,
      previous: null,
    });
  });

  it("does not dim a range that is shown again", () => {
    const first = moveHighlight(undefined, "a.ts", { start: 2, end: 4 });

    expect(moveHighlight(first, "a.ts", { start: 2, end: 4 }).previous).toBeNull();
  });
});
