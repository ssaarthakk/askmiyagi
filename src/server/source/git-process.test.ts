import { describe, expect, it } from "vitest";
import { runGit } from "./git-process.ts";

describe("runGit", () => {
  it("says git took too long when the timeout stops it", async () => {
    const signal = AbortSignal.abort(new DOMException("timed out", "TimeoutError"));

    await expect(runGit(["--version"], { env: { ...process.env }, signal })).rejects.toThrow(
      "git took too long and was stopped",
    );
  });

  it("says git was not found when it is not installed", async () => {
    const signal = new AbortController().signal;

    await expect(runGit(["--version"], { env: { PATH: "" }, signal })).rejects.toThrow(
      "Git was not found",
    );
  });
});
