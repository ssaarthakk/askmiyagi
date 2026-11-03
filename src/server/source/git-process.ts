import { spawn } from "node:child_process";
import { once } from "node:events";
import { killTree, stderrTailLength } from "../llm/claude-process.ts";

const maximumOutputBytes = 2_000_000;

type GitOptions = { cwd?: string; env: NodeJS.ProcessEnv; signal: AbortSignal };

function isTimeout(reason: unknown) {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

async function exitCode(child: ReturnType<typeof spawn>) {
  try {
    const [code] = await once(child, "close");
    return code as number | null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Git was not found. Install git, then try again.");
    }
    throw error;
  }
}

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
    const code = await exitCode(child);
    if (signal.aborted) {
      throw new Error(
        isTimeout(signal.reason)
          ? "git took too long and was stopped"
          : "stopped before it finished",
      );
    }
    if (code !== 0 && !truncated) throw new Error(stderr.trim() || "git failed");
    return { stdout: Buffer.concat(chunks).toString("utf8"), truncated };
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
