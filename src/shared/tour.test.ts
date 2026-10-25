import { describe, expect, it } from "vitest";
import { anchorSchema, resolvedAnchorSchema, type Selection, selectionSchema } from "./anchor.ts";
import { parseContract } from "./parse.ts";
import { type Step, stepSchema, type Tour, tourSchema } from "./tour.ts";

const symbolAnchor = { file: "src/clip.ts", symbol: "ClipService.save" };
const lineAnchor = { file: "src/clip.ts", line: 12, text: "return save(clip)" };
const step: Step = {
  title: "Saving a clip",
  anchors: [symbolAnchor],
  narration: [{ text: "First it saves the clip.", anchor: 0 }, { text: "Then it returns." }],
};

function errorOf(result: ReturnType<typeof parseContract>) {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
}

describe("anchors", () => {
  it("accepts a symbol anchor and a line anchor", () => {
    expect(parseContract(anchorSchema, symbolAnchor)).toEqual({ ok: true, value: symbolAnchor });
    expect(parseContract(anchorSchema, lineAnchor)).toEqual({ ok: true, value: lineAnchor });
  });

  it("rejects an anchor that is neither shape and says what is expected", () => {
    const error = errorOf(parseContract(anchorSchema, { file: "src/clip.ts", line: 12 }));
    expect(error).toContain("{ file, symbol }");
    expect(error).toContain("{ file, line, text }");
  });

  it("rejects a non-positive or fractional line", () => {
    expect(parseContract(anchorSchema, { ...lineAnchor, line: 0 }).ok).toBe(false);
    expect(parseContract(anchorSchema, { ...lineAnchor, line: 1.5 }).ok).toBe(false);
  });

  it("validates resolved anchors and selections", () => {
    const resolved = { file: "a.ts", start: 3, end: 9, capped: false };
    expect(parseContract(resolvedAnchorSchema, resolved)).toEqual({ ok: true, value: resolved });
    expect(parseContract(resolvedAnchorSchema, { ...resolved, capped: "no" }).ok).toBe(false);
    const selection: Selection = { file: "a.ts", start: 3, end: 9, text: "code" };
    expect(parseContract(selectionSchema, selection)).toEqual({ ok: true, value: selection });
    expect(parseContract(selectionSchema, { ...selection, text: undefined }).ok).toBe(false);
  });
});

describe("steps", () => {
  it("accepts a step with one to three anchors", () => {
    expect(parseContract(stepSchema, step).ok).toBe(true);
    const three = { ...step, anchors: [symbolAnchor, lineAnchor, symbolAnchor] };
    expect(parseContract(stepSchema, three).ok).toBe(true);
  });

  it("rejects a step with no anchors or with four", () => {
    expect(errorOf(parseContract(stepSchema, { ...step, anchors: [] }))).toContain("anchors");
    const four = { ...step, anchors: [symbolAnchor, symbolAnchor, symbolAnchor, symbolAnchor] };
    expect(errorOf(parseContract(stepSchema, four))).toContain("anchors");
  });

  it("rejects a narration anchor index that points past the anchors", () => {
    const bad = { ...step, narration: [{ text: "Look here.", anchor: 1 }] };
    expect(errorOf(parseContract(stepSchema, bad))).toContain("narration.0.anchor");
  });

  it("lists every problem, one per line, with its path", () => {
    const error = errorOf(
      parseContract(stepSchema, { title: "", anchors: [], narration: [{ text: 5 }] }),
    );
    const lines = error.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split(":")[0]).sort()).toEqual([
      "anchors",
      "narration.0.text",
      "title",
    ]);
  });
});

describe("tours", () => {
  it("accepts a tour with and without a check question", () => {
    const tour: Tour = { question: "How are clips saved?", steps: [step] };
    expect(parseContract(tourSchema, tour)).toEqual({ ok: true, value: tour });
    const withCheck = { ...tour, checkQuestion: "What does save return?" };
    expect(parseContract(tourSchema, withCheck)).toEqual({ ok: true, value: withCheck });
  });

  it("names the failing step when one step is invalid", () => {
    const error = errorOf(
      parseContract(tourSchema, { question: "q", steps: [step, { ...step, anchors: [] }] }),
    );
    expect(error).toContain("steps.1.anchors");
  });

  it("reports non-object data without a path", () => {
    expect(errorOf(parseContract(tourSchema, "nope"))).toMatch(/expected object/i);
  });
});
