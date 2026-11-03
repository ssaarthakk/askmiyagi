import type { DiffBase } from "../../shared/diff-base.ts";
import type { Result } from "../../shared/result.ts";
import { isVisibleInDiff } from "../files/file-filter.ts";
import { redact } from "../files/redact.ts";
import { gitTool } from "../tools/git.ts";
import { gitEnvironment, runGit } from "./git-process.ts";
import { diffAgainstSnapshot, readSnapshotFile } from "./snapshot.ts";

const timeoutMs = 30_000;
const defaultBranches = ["origin/HEAD", "main", "master"];
const maximumCommitMessages = 50;
const maximumMessageCharacters = 2000;
const noDefaultBranch = "No default branch found: tried origin/HEAD, main and master.";

async function objectId(root: string, revision: string, signal: AbortSignal) {
  const run = await runGit(["rev-parse", "--verify", "--quiet", revision], {
    cwd: root,
    env: gitEnvironment(),
    signal,
    successCodes: [0, 1],
  });
  return run.stdout.trim();
}

async function defaultBranch(root: string, signal: AbortSignal) {
  for (const name of defaultBranches) {
    if (await objectId(root, `${name}^{commit}`, signal)) return name;
  }
  return undefined;
}

async function diffFromGit(
  root: string,
  base: "uncommitted" | "branch",
  signal: AbortSignal,
): Promise<Result<string>> {
  const commit = await baseCommit(root, base, signal);
  if (!commit.ok) return commit;
  const args = base === "uncommitted" ? [commit.value] : [commit.value, "HEAD"];
  const result = await gitTool(root, { command: "diff", args }, Number.POSITIVE_INFINITY);
  return result.isError ? { ok: false, error: result.text } : { ok: true, value: result.text };
}

function failure(error: unknown): Result<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export async function diffAgainstBase(root: string, base: DiffBase): Promise<Result<string>> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (base !== "snapshot") return await diffFromGit(root, base, signal);
    return await diffAgainstSnapshot(root, signal);
  } catch (error) {
    return failure(error);
  }
}

export async function branchCommitMessages(root: string): Promise<Result<string[]>> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const branch = await defaultBranch(root, signal);
    if (!branch) return { ok: false, error: noDefaultBranch };
    const run = await runGit(
      [
        "-c",
        "log.showSignature=false",
        "log",
        "--no-color",
        "--format=%B%x00",
        "-n",
        String(maximumCommitMessages),
        `${branch}..HEAD`,
      ],
      { cwd: root, env: gitEnvironment(), signal },
    );
    const messages = run.stdout
      .split("\0")
      .map((message) => message.trim().slice(0, maximumMessageCharacters))
      .filter((message) => message !== "");
    return { ok: true, value: messages };
  } catch (error) {
    return failure(error);
  }
}

async function baseCommit(
  root: string,
  base: "uncommitted" | "branch",
  signal: AbortSignal,
): Promise<Result<string>> {
  if (base === "uncommitted") return { ok: true, value: "HEAD" };
  const branch = await defaultBranch(root, signal);
  if (!branch) return { ok: false, error: noDefaultBranch };
  const run = await runGit(["merge-base", branch, "HEAD"], {
    cwd: root,
    env: gitEnvironment(),
    signal,
    successCodes: [0, 1],
  });
  const commit = run.stdout.trim();
  return commit
    ? { ok: true, value: commit }
    : { ok: false, error: `No common commit with ${branch}` };
}

async function readFromGit(
  root: string,
  base: "uncommitted" | "branch",
  path: string,
  signal: AbortSignal,
): Promise<Result<string>> {
  const commit = await baseCommit(root, base, signal);
  if (!commit.ok) return commit;
  const object = await objectId(root, `${commit.value}:./${path}`, signal);
  if (!object) return { ok: false, error: `Not in the base version: ${path}` };
  const blob = await objectId(root, `${object}^{blob}`, signal);
  if (!blob) return { ok: false, error: `Not a file: ${path}` };
  const run = await runGit(["show", "--no-textconv", blob], {
    cwd: root,
    env: gitEnvironment(),
    signal,
  });
  return run.truncated
    ? { ok: false, error: `File is too large: ${path}` }
    : { ok: true, value: run.stdout };
}

export async function readBaseFile(
  root: string,
  base: DiffBase,
  path: string,
): Promise<Result<{ relPath: string; source: string }>> {
  const relPath = path.replaceAll("\\", "/");
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (!(await isVisibleInDiff(root, relPath))) {
      return { ok: false, error: "Path is not a visible file" };
    }
    const content =
      base === "snapshot"
        ? await readSnapshotFile(root, relPath)
        : await readFromGit(root, base, relPath, signal);
    if (!content.ok) return content;
    if (content.value.includes("\0")) return { ok: false, error: `Not a text file: ${relPath}` };
    return { ok: true, value: { relPath, source: redact(content.value) } };
  } catch (error) {
    return failure(error);
  }
}
