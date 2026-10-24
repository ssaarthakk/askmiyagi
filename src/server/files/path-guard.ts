import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { Result } from "../../shared/result.ts";
import { isVisible } from "./file-filter.ts";
import { redact } from "./redact.ts";

export type GuardedPath = { realPath: string; relPath: string };

function isOutsideRoot(root: string, path: string) {
  if (process.platform === "win32" || process.platform === "darwin") {
    const normalizedRoot = root.toLowerCase();
    const normalizedPath = path.toLowerCase();
    const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
    return normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPrefix);
  }

  const pathFromRoot = relative(root, path);
  return pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot);
}

function isAbsoluteInput(path: string) {
  return isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path);
}

export async function guardPath(root: string, requested: string): Promise<Result<GuardedPath>> {
  if (!requested || isAbsoluteInput(requested)) {
    return { ok: false, error: "Path must be project-relative" };
  }

  const relPath = requested.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
  if (!relPath || relPath.split("/").every((segment) => segment === ".")) {
    return { ok: false, error: "Path must identify a project file" };
  }

  let realRoot: string;
  let realPath: string;
  try {
    realRoot = await realpath(root);
    realPath = await realpath(resolve(realRoot, ...relPath.split("/")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return { ok: false, error: "Path does not exist" };
    }
    throw error;
  }

  if (isOutsideRoot(realRoot, realPath)) {
    return { ok: false, error: "Path escapes project root" };
  }

  const normalizedPath = relative(realRoot, realPath).split(sep).join("/");
  if (!normalizedPath) {
    return { ok: false, error: "Path is not a visible file" };
  }

  let visible: boolean;
  try {
    visible = await isVisible(realRoot, normalizedPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason.replace(/[\r\n]+/g, " ") };
  }
  if (!visible) return { ok: false, error: "Path is not a visible file" };

  return { ok: true, value: { realPath, relPath: normalizedPath } };
}

export async function readRedactedFile(
  root: string,
  requested: string,
): Promise<Result<{ relPath: string; source: string }>> {
  const guarded = await guardPath(root, requested);
  if (!guarded.ok) return guarded;
  const source = redact(await readFile(guarded.value.realPath, "utf8"));
  return { ok: true, value: { relPath: guarded.value.relPath, source } };
}
