import { describe, expect, it } from "vitest";
import { leaksHint } from "./no-hints.ts";

const sources = ["Storage keeps one fixed number, and hands it on unchanged!"];

describe("leaksHint", () => {
  it("flags a run of 4 shared words, ignoring case and punctuation", () => {
    expect(leaksHint("So, ONE fixed number... then what?", sources)).toBe(false);
    expect(leaksHint("keeps ONE fixed number, right?", sources)).toBe(true);
  });

  it("does not flag 3 shared words", () => {
    expect(leaksHint("one fixed number only", sources)).toBe(false);
  });

  it("flags a run found in any one of the texts", () => {
    expect(leaksHint("hands it on unchanged", ["nothing here", ...sources])).toBe(true);
  });

  it("does not join words from different texts into one run", () => {
    expect(leaksHint("fixed number hands it", ["one fixed number", "hands it on"])).toBe(false);
  });

  it("flags nothing for an empty say or empty texts", () => {
    expect(leaksHint("", sources)).toBe(false);
    expect(leaksHint("one fixed number and", [""])).toBe(false);
  });
});
