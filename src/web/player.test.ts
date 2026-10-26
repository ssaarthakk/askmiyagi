import { describe, expect, it } from "vitest";
import { anchorTarget, firstPosition, neighbour, type PlayerStep } from "./player.ts";

const first = { file: "a.ts", start: 1, end: 3, capped: false };
const second = { file: "b.ts", start: 5, end: 6, capped: false };

const steps: PlayerStep[] = [
  {
    step: {
      title: "One",
      anchors: [
        { file: "a.ts", symbol: "A" },
        { file: "b.ts", symbol: "B" },
      ],
      narration: [{ text: "first", anchor: 1 }, { text: "second" }],
    },
    ranges: [first, second],
  },
  {
    step: {
      title: "Two",
      anchors: [{ file: "c.ts", symbol: "C" }],
      narration: [{ text: "third" }],
    },
    ranges: [null],
  },
];

describe("neighbour", () => {
  it("moves to the next segment within a step", () => {
    expect(neighbour(steps, { step: 0, segment: 0 }, 1)).toEqual({ step: 0, segment: 1 });
  });

  it("moves across steps in both directions", () => {
    expect(neighbour(steps, { step: 0, segment: 1 }, 1)).toEqual({ step: 1, segment: 0 });
    expect(neighbour(steps, { step: 1, segment: 0 }, -1)).toEqual({ step: 0, segment: 1 });
  });

  it("has no neighbour past either end", () => {
    expect(neighbour(steps, { step: 0, segment: 0 }, -1)).toBeUndefined();
    expect(neighbour(steps, { step: 1, segment: 0 }, 1)).toBeUndefined();
  });

  it("skips steps with no narration", () => {
    const silent: PlayerStep = {
      step: { title: "Silent", anchors: [{ file: "d.ts", symbol: "D" }], narration: [] },
      ranges: [null],
    };
    const list = [steps[0], silent, steps[1]].filter((entry) => entry !== undefined);

    expect(neighbour(list, { step: 0, segment: 1 }, 1)).toEqual({ step: 2, segment: 0 });
  });
});

describe("firstPosition", () => {
  it("is the first segment of the first step", () => {
    expect(firstPosition(steps)).toEqual({ step: 0, segment: 0 });
  });

  it("skips leading steps with no narration", () => {
    const silent: PlayerStep = {
      step: { title: "Silent", anchors: [{ file: "d.ts", symbol: "D" }], narration: [] },
      ranges: [null],
    };

    expect(firstPosition([silent, ...steps])).toEqual({ step: 1, segment: 0 });
  });

  it("is undefined when nothing is narrated", () => {
    expect(firstPosition([])).toBeUndefined();
  });
});

describe("anchorTarget", () => {
  it("uses the anchor the segment points at", () => {
    const entry = steps[0] as PlayerStep;

    expect(anchorTarget(entry, 0)).toEqual({ file: "b.ts", range: second });
  });

  it("falls back to the step's first anchor", () => {
    const entry = steps[0] as PlayerStep;

    expect(anchorTarget(entry, 1)).toEqual({ file: "a.ts", range: first });
  });

  it("gives a null range when the anchor could not be resolved", () => {
    const entry = steps[1] as PlayerStep;

    expect(anchorTarget(entry, 0)).toEqual({ file: "c.ts", range: null });
  });
});
