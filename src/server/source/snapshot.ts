import { copyFile, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { Result } from "../../shared/result.ts";
import { isVisibleInDiff, listVisibleFiles } from "../files/file-filter.ts";
import { isOutsideRoot } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";
import { noChanges } from "../tools/git.ts";
import { privateFileOrProblem } from "../tutor-folder.ts";
import { gitEnvironment, runGit } from "./git-process.ts";

type Change = "modified" | "added" | "deleted";

const snapshotName = "snapshot";
const snapshotFolder = `.tutor/private/${snapshotName}`;
const noSnapshot = "There is no snapshot yet. Run askmiyagi snapshot first.";
const noFile = "/dev/null";
const missingFileCodes = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

async function projectFiles(root: string) {
  return (await listVisibleFiles(root)).filter((path) => !path.startsWith(".tutor/"));
}

export async function createSnapshot(root: string): Promise<Result<number>> {
  const folder = await privateFileOrProblem(root, snapshotName);
  if (!folder.ok) return folder;
  await rm(folder.value, { recursive: true, force: true });
  const files = await projectFiles(root);
  for (const path of files) {
    const target = join(folder.value, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
  return { ok: true, value: files.length };
}

async function snapshotRoot(root: string): Promise<Result<string>> {
  let folder: string;
  try {
    folder = await realpath(join(root, snapshotFolder));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, error: noSnapshot };
    throw error;
  }
  if (isOutsideRoot(await realpath(root), folder)) {
    return { ok: false, error: "The snapshot folder is outside the project" };
  }
  return { ok: true, value: folder };
}

async function snapshotFiles(root: string): Promise<Result<{ folder: string; files: string[] }>> {
  const found = await snapshotRoot(root);
  if (!found.ok) return found;
  const folder = found.value;
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
  return { ok: true, value: { folder, files } };
}

export async function readSnapshotFile(root: string, path: string): Promise<Result<string>> {
  const found = await snapshotRoot(root);
  if (!found.ok) return found;
  try {
    const real = await realpath(join(found.value, path));
    if (isOutsideRoot(found.value, real)) {
      return { ok: false, error: "The snapshot file is outside the snapshot" };
    }
    return { ok: true, value: await readFile(real, "utf8") };
  } catch (error) {
    if (missingFileCodes.has((error as NodeJS.ErrnoException).code ?? "")) {
      return { ok: false, error: `Not in the snapshot: ${path}` };
    }
    throw error;
  }
}

async function changeOf(
  root: string,
  snapshot: { folder: string; files: Set<string> },
  current: Set<string>,
  path: string,
): Promise<Change | undefined> {
  const before = snapshot.files.has(path);
  if (before && current.has(path)) {
    const unchanged = (await readFile(join(snapshot.folder, path))).equals(
      await readFile(join(root, path)),
    );
    return unchanged ? undefined : "modified";
  }
  if (current.has(path)) return "added";
  return (await isVisibleInDiff(root, path)) ? "deleted" : undefined;
}

async function fileDiff(root: string, path: string, change: Change, signal: AbortSignal) {
  const oldPath = change === "added" ? noFile : `${snapshotFolder}/${path}`;
  const newPath = change === "deleted" ? noFile : path;
  const run = await runGit(
    [
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--",
      oldPath,
      newPath,
    ],
    { cwd: root, env: gitEnvironment(), signal, successCodes: [0, 1] },
  );
  const lines = run.stdout.replace(/\n+$/, "").split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
  return [
    `diff --git a/${path} b/${path}`,
    `--- ${change === "added" ? noFile : `a/${path}`}`,
    `+++ ${change === "deleted" ? noFile : `b/${path}`}`,
    ...(firstHunk === -1 ? [] : lines.slice(firstHunk)),
  ];
}

export async function diffAgainstSnapshot(
  root: string,
  signal: AbortSignal,
): Promise<Result<string>> {
  const found = await snapshotFiles(root);
  if (!found.ok) return found;
  const snapshot = { folder: found.value.folder, files: new Set(found.value.files) };
  const current = new Set(await projectFiles(root));
  const lines: string[] = [];
  for (const path of [...new Set([...snapshot.files, ...current])].sort()) {
    const change = await changeOf(root, snapshot, current, path);
    if (change) lines.push(...(await fileDiff(root, path, change, signal)));
  }
  return { ok: true, value: redact(lines.join("\n")) || noChanges };
}
