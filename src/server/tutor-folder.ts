import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { parseContract } from "../shared/parse.ts";
import type { Result } from "../shared/result.ts";
import { isOutsideRoot } from "./files/path-guard.ts";
import { logError } from "./log.ts";

const tutorGitignore = "*\n!.gitignore\n!tours/\n!tours/**\n";

function hasCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

async function checkNotLinked(realRoot: string, path: string): Promise<Result<boolean>> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return { ok: false, error: `${path} is a link` };
    if (isOutsideRoot(realRoot, await realpath(path))) {
      return { ok: false, error: `${path} is outside the project` };
    }
    return { ok: true, value: true };
  } catch (error) {
    if (hasCode(error, "ENOENT")) return { ok: true, value: false };
    throw error;
  }
}

export async function privateFileOrProblem(root: string, name: string): Promise<Result<string>> {
  const realRoot = await realpath(root);
  const tutorDir = join(realRoot, ".tutor");
  const privateDir = join(tutorDir, "private");
  for (const directory of [tutorDir, privateDir]) {
    let checked = await checkNotLinked(realRoot, directory);
    if (checked.ok && !checked.value) {
      await mkdir(directory).catch((error: unknown) => {
        if (!hasCode(error, "EEXIST")) throw error;
      });
      checked = await checkNotLinked(realRoot, directory);
    }
    if (!checked.ok) return checked;
  }
  await writeFile(join(tutorDir, ".gitignore"), tutorGitignore, { flag: "wx" }).catch(
    (error: unknown) => {
      if (!hasCode(error, "EEXIST")) throw error;
    },
  );
  const file = join(privateDir, name);
  const checked = await checkNotLinked(realRoot, file);
  return checked.ok ? { ok: true, value: file } : checked;
}

export async function writePrivateFile(
  root: string,
  name: string,
  failure: string,
  write: (file: string) => Promise<void>,
) {
  try {
    const file = await privateFileOrProblem(root, name);
    if (file.ok) await write(file.value);
    else logError(`${failure}: ${file.error}`);
  } catch (error) {
    logError(`${failure}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readPrivateJson<T>(
  root: string,
  name: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const file = await privateFileOrProblem(root, name);
    if (!file.ok) {
      logError(`${name} not read: ${file.error}`);
      return null;
    }
    let text: string;
    try {
      text = await readFile(file.value, "utf8");
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = parseContract(schema, json);
    if (parsed.ok) return parsed.value;
    await rename(file.value, `${file.value}.corrupt`);
    logError(
      `${name} is not valid and was moved to ${name}.corrupt: ${parsed.error.replaceAll("\n", "; ")}`,
    );
    return null;
  } catch (error) {
    logError(`${name} not read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
