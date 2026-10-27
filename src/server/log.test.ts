import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "./log.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logError", () => {
  it("drops terminal control sequences from text written to the terminal", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    logError("No highlight for \u001b]52;c;aGk=\u0007a.ts\rfake");

    expect(write).toHaveBeenCalledWith("miyagi: No highlight for ]52;c;aGk=a.tsfake\n");
  });
});
