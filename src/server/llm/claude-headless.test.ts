import { afterEach, describe, expect, it, vi } from "vitest";
import { collect, fakeEnv, request, tempDir } from "../../../test/fake-claude.ts";
import { claudeHeadless } from "./claude-headless.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ask = () =>
  collect(claudeHeadless.ask({ ...request, tools: false }, new AbortController().signal));

describe("claudeHeadless", () => {
  it("gives an error event when Claude Code is not installed", async () => {
    vi.stubEnv("PATH", await tempDir());
    expect(await ask()).toEqual([
      { type: "error", message: expect.stringMatching(/not found/i), retryable: false },
    ]);
  });

  it("gives a clear error event when Claude Code is logged out", async () => {
    const { env } = await fakeEnv("logged-out");
    for (const name of ["PATH", "FAKE_MODE", "FAKE_RECORD"]) vi.stubEnv(name, env[name]);
    const events = await ask();
    expect(events[0]).toEqual({
      type: "error",
      message: expect.stringMatching(/not logged in.*claude/i),
      retryable: false,
    });
  });
});
