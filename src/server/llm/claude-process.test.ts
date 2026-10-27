import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collect,
  fakeEnv,
  recorded,
  request,
  tempDir,
  waitForFile,
  waitUntilDead,
} from "../../../test/fake-claude.ts";
import { ClaudeProcessError, claudeArgs, runClaude, spawnCommand } from "./claude-process.ts";
import { renderPrompt } from "./prompt.ts";

describe("claudeArgs", () => {
  it("runs print mode with stream JSON, no built-in tools, only Miyagi's MCP server and no user settings", () => {
    const args = claudeArgs("/tmp/mcp.json");
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--output-format stream-json");
    expect(args).toContain("--verbose");
    expect(args).toContain("--include-partial-messages");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/mcp.json");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe("mcp__miyagi__*");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--disable-slash-commands");
  });

  it("picks no model unless one is chosen", () => {
    expect(claudeArgs("/tmp/mcp.json")).not.toContain("--model");
    const args = claudeArgs("/tmp/mcp.json", "sonnet");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("allows no tools and loads no MCP server when the request has no tools", () => {
    const args = claudeArgs(undefined);
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("--allowedTools");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});

describe("spawnCommand", () => {
  it("runs a Windows exe directly", () => {
    expect(spawnCommand("win32", "C:\\bin\\claude.exe", ["-p"], "C:\\Windows\\cmd.exe")).toEqual({
      command: "C:\\bin\\claude.exe",
      args: ["-p"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs a Windows cmd shim through cmd.exe with every argument quoted", () => {
    expect(
      spawnCommand("win32", "C:\\npm\\claude.cmd", ["-p", "--tools", ""], "C:\\Windows\\cmd.exe"),
    ).toEqual({
      command: "C:\\Windows\\cmd.exe",
      args: ["/d", "/s", "/c", '""C:\\npm\\claude.cmd" "-p" "--tools" """'],
      windowsVerbatimArguments: true,
    });
  });

  it("refuses an argument that cmd.exe could expand or break out of", () => {
    for (const bad of ['a"b', "%PATH%"]) {
      expect(() => spawnCommand("win32", "C:\\npm\\claude.cmd", [bad], "cmd.exe")).toThrow(
        ClaudeProcessError,
      );
    }
  });

  it("runs the executable directly on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(spawnCommand(platform, "/usr/local/bin/claude", ["-p"], "cmd.exe")).toEqual({
        command: "/usr/local/bin/claude",
        args: ["-p"],
        windowsVerbatimArguments: false,
      });
    }
  });
});

describe("runClaude", () => {
  it("streams stdout lines and sends the whole prompt on stdin", async () => {
    const { env, work } = await fakeEnv("ok");
    const lines = await collect(runClaude(request, new AbortController().signal, { env }));
    expect(lines).toEqual(['{"type":"system"}', '{"type":"result"}']);
    const record = await recorded(work);
    expect(record.stdin).toBe(renderPrompt(request));
    expect(record.args).toEqual(claudeArgs(record.args[record.args.indexOf("--mcp-config") + 1]));
  });

  it("hands the chosen model to Claude Code", async () => {
    const { env, work } = await fakeEnv("ok");
    await collect(runClaude(request, new AbortController().signal, { env, model: "sonnet" }));
    const { args } = await recorded(work);
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("points the MCP config at the running CLI with mcp <root>", async () => {
    const { env, work } = await fakeEnv("ok");
    await collect(runClaude(request, new AbortController().signal, { env }));
    const record = await recorded(work);
    expect(record.mcpConfig).toEqual({
      mcpServers: {
        miyagi: { command: process.execPath, args: [process.argv[1], "mcp", "/some/repo"] },
      },
    });
  });

  it("runs in an empty temp folder that is removed afterwards", async () => {
    const { env, work } = await fakeEnv("ok");
    await collect(runClaude(request, new AbortController().signal, { env }));
    const record = await recorded(work);
    expect(record.cwdEntries).toEqual([]);
    expect(record.cwd.startsWith(tmpdir()) || record.cwd.includes("miyagi-claude")).toBe(true);
    await expect(stat(record.cwd)).rejects.toThrow();
  });

  it("does not hand the ElevenLabs key to Claude Code and turns off its nonessential traffic", async () => {
    const { env, work } = await fakeEnv("ok", { ELEVENLABS_API_KEY: "secret-voice-key" });
    await collect(runClaude(request, new AbortController().signal, { env }));
    const record = await recorded(work);
    expect(record.envKeys).not.toContain("ELEVENLABS_API_KEY");
    expect(record.disableTraffic).toBe("1");
  });

  it("gives a clear error when Claude Code is not installed", async () => {
    const empty = await tempDir();
    const stream = runClaude(request, new AbortController().signal, { env: { PATH: empty } });
    await expect(collect(stream)).rejects.toThrow(/Claude Code was not found/);
  });

  it("reports a failed run with its exit code and error output", async () => {
    const { env } = await fakeEnv("fail");
    const stream = runClaude(request, new AbortController().signal, { env });
    await expect(collect(stream)).rejects.toThrow(/exited with code 3.*boom happened/s);
  });

  it("kills the whole process tree and reports a retryable timeout", async () => {
    const { env, work } = await fakeEnv("hang");
    const stream = runClaude(request, new AbortController().signal, { env, timeoutMs: 1500 });
    const failure = await collect(stream).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ClaudeProcessError);
    expect(failure).toMatchObject({
      retryable: true,
      message: expect.stringMatching(/timed out/i),
    });
    const [grandchild, child] = (await waitForFile(join(work, "pids.txt"))).split(",").map(Number);
    expect(await waitUntilDead(grandchild as number)).toBe(true);
    expect(await waitUntilDead(child as number)).toBe(true);
  });

  it("kills the whole process tree and ends quietly when aborted", async () => {
    const { env, work } = await fakeEnv("hang");
    const controller = new AbortController();
    const stream = runClaude(request, controller.signal, { env });
    const first = await stream.next();
    expect(first).toEqual({ done: false, value: '{"type":"system"}' });
    const [grandchild, child] = (await waitForFile(join(work, "pids.txt"))).split(",").map(Number);
    controller.abort();
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(await waitUntilDead(grandchild as number)).toBe(true);
    expect(await waitUntilDead(child as number)).toBe(true);
  });

  it("does not start Claude Code when already aborted", async () => {
    const { env, work } = await fakeEnv("ok");
    const controller = new AbortController();
    controller.abort();
    expect(await collect(runClaude(request, controller.signal, { env }))).toEqual([]);
    await expect(stat(join(work, "record.json"))).rejects.toThrow();
  });

  it("kills the process when the consumer stops reading", async () => {
    const { env, work } = await fakeEnv("hang");
    const stream = runClaude(request, new AbortController().signal, { env });
    await stream.next();
    const [grandchild] = (await waitForFile(join(work, "pids.txt"))).split(",").map(Number);
    await stream.return(undefined);
    expect(await waitUntilDead(grandchild as number)).toBe(true);
  });
});

describe("PATH search", () => {
  it("uses the delimiter-separated directories of PATH", async () => {
    const { env } = await fakeEnv("ok");
    const empty = await tempDir();
    env.PATH = `${empty}${delimiter}${env.PATH}`;
    expect(await collect(runClaude(request, new AbortController().signal, { env }))).toHaveLength(
      2,
    );
  });
});
