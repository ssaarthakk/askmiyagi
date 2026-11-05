import { afterEach, describe, expect, it, vi } from "vitest";
import { collect, fakeEnv, recorded, request } from "../../../test/fake-claude.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { claudeHeadless } from "./claude-headless.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

const ask = (part: Partial<typeof request> = {}, model?: string) =>
  collect(
    claudeHeadless(model).ask({ ...request, tools: false, ...part }, new AbortController().signal),
  );

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

  describe("model routing", () => {
    async function modelArgument(part: Partial<typeof request>, model?: string) {
      const { env, work } = await fakeEnv("ok");
      for (const name of ["PATH", "FAKE_MODE", "FAKE_RECORD"]) vi.stubEnv(name, env[name]);
      await ask(part, model);
      const { args } = await recorded(work);
      return args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
    }

    it("passes the small model for a small request, whatever strong model is chosen", async () => {
      expect(await modelArgument({ model: "small" }, "sonnet")).toBe("claude-haiku-5-5");
    });

    it("passes the chosen model for a strong request, and Opus when none is chosen", async () => {
      expect(await modelArgument({ model: "strong" }, "sonnet")).toBe("sonnet");
      expect(await modelArgument({ model: "strong" })).toBe("claude-opus-5-5");
    });
  });
});
