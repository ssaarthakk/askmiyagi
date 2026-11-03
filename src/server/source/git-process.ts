import { spawn } from "node:child_process";
import { once } from "node:events";
import { killTree, stderrTailLength } from "../llm/claude-process.ts";

const maximumOutputBytes = 2_000_000;

type GitOptions = { cwd?: string; env: Record<string, string>; signal: AbortSignal };

export async function runGit(args: string[], { cwd, env, signal }: GitOptions) {
  const child = spawn("git", args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  let stderr = "";
  const stop = () => void killTree(child);
  child.stdout.on("data", (chunk: Buffer) => {
    if (truncated) return;
    chunks.push(chunk);
    bytes += chunk.length;
    if (bytes <= maximumOutputBytes) return;
    truncated = true;
    stop();
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-stderrTailLength);
  });
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const [code] = await once(child, "close");
    if (signal.aborted) throw new Error("stopped before it finished");
    if (code !== 0 && !truncated) throw new Error(stderr.trim() || "git failed");
    return { stdout: Buffer.concat(chunks).toString("utf8"), truncated };
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
