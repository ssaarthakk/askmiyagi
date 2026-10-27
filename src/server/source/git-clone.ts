import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../../shared/result.ts";
import { killTree, stderrTailLength, withoutVoiceKey } from "../llm/claude-process.ts";
import { parseGitHubUrl } from "./github-url.ts";
import type { CodeSource } from "./local-folder.ts";

const cloneTimeoutMs = 300_000;

const lockedDownArgs = [
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.required=false",
  "-c",
  "credential.helper=",
];

async function runClone(args: string[], signal: AbortSignal) {
  const child = spawn("git", args, {
    env: {
      ...withoutVoiceKey(process.env),
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GCM_INTERACTIVE: "Never",
    },
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-stderrTailLength);
  });
  const stop = () => void killTree(child);
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const [code] = await once(child, "close");
    if (signal.aborted) throw new Error("stopped before it finished");
    if (code !== 0) throw new Error(stderr.trim());
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function cloneRepository(
  cloneUrl: string,
  signal: AbortSignal,
): Promise<Result<CodeSource>> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "miyagi-clone-")));
  const root = join(folder, "repo");
  const dispose = () => rm(folder, { recursive: true, force: true, maxRetries: 3 });
  try {
    await runClone(
      [
        ...lockedDownArgs,
        "clone",
        "--depth",
        "1",
        "--no-recurse-submodules",
        "--quiet",
        "--",
        cloneUrl,
        root,
      ],
      AbortSignal.any([signal, AbortSignal.timeout(cloneTimeoutMs)]),
    );
  } catch (error) {
    const cleanup = await dispose().then(
      () => "",
      (rmError: unknown) => ` (and could not delete ${folder}: ${errorMessage(rmError)})`,
    );
    return { ok: false, error: `Could not clone ${cloneUrl}: ${errorMessage(error)}${cleanup}` };
  }
  return { ok: true, value: { root, dispose } };
}

export async function openGitClone(url: string, signal: AbortSignal): Promise<Result<CodeSource>> {
  const parsed = parseGitHubUrl(url);
  return parsed.ok ? cloneRepository(parsed.value, signal) : parsed;
}
