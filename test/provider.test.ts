import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/server/cli-args.ts";
import { root, sourceCli, startCli, waitForExit, waitForLine } from "./cli-harness.ts";

describe("provider option", () => {
  const withoutKeys = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "ANTHROPIC_API_KEY" && name !== "GEMINI_API_KEY",
    ),
  );

  it("defaults to claude-headless and accepts the API providers", () => {
    expect(parseCliArgs([]).provider).toBe("claude-headless");
    expect(parseCliArgs(["--provider", "claude-api"]).provider).toBe("claude-api");
    expect(parseCliArgs(["--provider", "gemini"]).provider).toBe("gemini");
  });

  it.each([
    ["claude-api", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
  ])("refuses %s without %s", async (provider, key) => {
    const childProcess = startCli(
      sourceCli,
      ["--no-open", "--provider", provider],
      root,
      withoutKeys,
    );
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe(`Set ${key} to use --provider ${provider}`);
  });

  it.each([
    ["claude-api", "ANTHROPIC_API_KEY"],
    ["gemini", "GEMINI_API_KEY"],
  ])("starts with %s when %s is set", async (provider, key) => {
    const childProcess = startCli(
      sourceCli,
      ["--no-open", "--port", "0", "--provider", provider, join(root, "test", "fixtures", "basic")],
      root,
      { ...withoutKeys, [key]: "test-key" },
    );
    await expect(waitForLine(childProcess)).resolves.toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(childProcess.stderr).toBe("");
  });

  it("refuses claude-headless when Claude Code is not installed", async () => {
    const childProcess = startCli(sourceCli, ["--no-open"], root, { ...withoutKeys, PATH: "" });
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe(
      "Claude Code was not found. Install Claude Code, run `claude` once to log in, then try again.",
    );
  });
});
