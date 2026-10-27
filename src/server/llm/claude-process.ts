import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { once } from "node:events";
import { access, constants, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { renderPrompt } from "./prompt.ts";

const execFileAsync = promisify(execFile);

const defaultTimeoutMs = 120_000;
const taskkillNotFound = 128;
export const stderrTailLength = 2000;

export class ClaudeProcessError extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

export function claudeArgs(mcpConfigPath: string | undefined) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--strict-mcp-config",
  ];
  if (mcpConfigPath !== undefined) {
    args.push("--mcp-config", mcpConfigPath, "--allowedTools", "mcp__miyagi__*");
  }
  return args;
}

export function spawnCommand(
  platform: NodeJS.Platform,
  file: string,
  args: string[],
  comSpec: string,
) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    if ([file, ...args].some((part) => /["%]/.test(part))) {
      throw new ClaudeProcessError(`Cannot start Claude Code through cmd.exe with: ${file}`);
    }
    const line = [file, ...args].map((part) => `"${part}"`).join(" ");
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", `"${line}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: file, args, windowsVerbatimArguments: false };
}

async function isUsableFile(file: string) {
  try {
    await access(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function findClaude(env: NodeJS.ProcessEnv) {
  const pathKey = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const directories = (pathKey ? (env[pathKey] ?? "") : "")
    .split(delimiter)
    .map((directory) => directory.replace(/^"(.*)"$/, "$1"))
    .filter((directory) => isAbsolute(directory));
  const names =
    process.platform === "win32" ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"];
  for (const directory of directories) {
    for (const name of names) {
      const file = join(directory, name);
      if (await isUsableFile(file)) return file;
    }
  }
  return undefined;
}

export function withoutVoiceKey(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) => value !== undefined && name.toUpperCase() !== "ELEVENLABS_API_KEY",
    ),
  );
}

function childEnv(env: NodeJS.ProcessEnv) {
  return {
    ...withoutVoiceKey(env),
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export async function killTree(child: ChildProcess) {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") {
      const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      await execFileAsync(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ESRCH" || code === taskkillNotFound) return;
    child.kill();
  }
}

async function* streamLines(
  child: ChildProcessWithoutNullStreams,
  prompt: string,
  signal: AbortSignal,
  timeoutMs: number,
) {
  let stderr = "";
  let exited = false;
  let stopReason: "timeout" | "abort" | undefined;
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", (code) => {
      exited = true;
      resolve(code);
    }),
  );
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-stderrTailLength);
  });
  child.on("error", (error) => {
    stderr += error.message;
  });
  child.stdin.on("error", () => {});
  child.stdin.end(prompt);

  const stop = (reason: "timeout" | "abort") => {
    stopReason ??= reason;
    void killTree(child);
  };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const onAbort = () => stop("abort");
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) stop("abort");

  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (line.trim() === "") continue;
      yield line;
    }
    const code = await closed;
    if (stopReason === "abort") return;
    if (stopReason === "timeout") {
      throw new ClaudeProcessError(
        `Claude Code timed out after ${Math.round(timeoutMs / 1000)} seconds`,
        true,
      );
    }
    if (code !== 0) {
      const detail = stderr.trim() === "" ? "" : `: ${stderr.trim()}`;
      throw new ClaudeProcessError(`Claude Code exited with code ${code}${detail}`);
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (!exited) {
      await killTree(child);
      await closed;
    }
  }
}

export async function* runClaude(
  request: LLMRequest,
  signal: AbortSignal,
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): AsyncGenerator<string> {
  const env = childEnv(options.env ?? process.env);
  const claude = await findClaude(env);
  if (claude === undefined) {
    throw new ClaudeProcessError(
      "Claude Code was not found. Install Claude Code, run `claude` once to log in, then try again.",
    );
  }
  if (signal.aborted) return;

  const directory = await mkdtemp(join(tmpdir(), "miyagi-claude-"));
  try {
    const cwd = join(directory, "cwd");
    await mkdir(cwd);
    let mcpConfigPath: string | undefined;
    if (request.tools) {
      mcpConfigPath = join(directory, "mcp.json");
      const config = {
        mcpServers: {
          miyagi: { command: process.execPath, args: [process.argv[1], "mcp", request.root] },
        },
      };
      await writeFile(mcpConfigPath, JSON.stringify(config));
    }
    const command = spawnCommand(
      process.platform,
      claude,
      claudeArgs(mcpConfigPath),
      process.env.ComSpec ?? "cmd.exe",
    );
    const child = spawn(command.command, command.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: command.windowsVerbatimArguments,
      detached: process.platform !== "win32",
    });
    try {
      await once(child, "spawn");
    } catch (error) {
      throw new ClaudeProcessError(`Could not start Claude Code: ${(error as Error).message}`);
    }
    yield* streamLines(child, renderPrompt(request), signal, options.timeoutMs ?? defaultTimeoutMs);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
