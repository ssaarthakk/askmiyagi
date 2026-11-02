import { describe, expect, it } from "vitest";
import { matchCommand, steppedSpeed } from "./commands.ts";

describe("matchCommand", () => {
  it.each([
    ["go back", "back"],
    ["repeat", "repeat"],
    ["skip", "skip"],
    ["slower", "slower"],
    ["faster", "faster"],
    ["pause", "pause"],
    ["resume", "resume"],
  ])("recognises %s", (spoken, command) => {
    expect(matchCommand(spoken)).toBe(command);
  });

  it.each(["Go back.", "  PAUSE!  ", "“Resume”", "Repeat…", "Slower, ", "(skip)"])(
    "ignores case and the punctuation around %s",
    (spoken) => {
      expect(matchCommand(spoken)).toBeDefined();
    },
  );

  it.each([
    "can you go back to the upload part",
    "why is it slower than before",
    "what does pause do",
    "skip this and explain the schema",
    "go back please",
    "resume resume",
  ])("treats the longer sentence %s as a question", (spoken) => {
    expect(matchCommand(spoken)).toBeUndefined();
  });

  it.each(["", "   ", "...", "How are clips saved?"])("finds no command in %j", (spoken) => {
    expect(matchCommand(spoken)).toBeUndefined();
  });
});

describe("steppedSpeed", () => {
  it("changes the speed by 0.25", () => {
    expect(steppedSpeed(1, 1)).toBe(1.25);
    expect(steppedSpeed(1, -1)).toBe(0.75);
  });

  it("stays within 0.5 and 2.0", () => {
    expect(steppedSpeed(0.5, -1)).toBe(0.5);
    expect(steppedSpeed(2, 1)).toBe(2);
    expect(steppedSpeed(1.75, 1)).toBe(2);
    expect(steppedSpeed(0.75, -1)).toBe(0.5);
  });
});
