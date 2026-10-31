import { appendFile, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallRecord } from "../shared/call-log.ts";
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

async function writeCallLog(root: string, record: CallRecord): Promise<Result<boolean>> {
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
  const file = join(privateDir, "calls.jsonl");
  const checked = await checkNotLinked(realRoot, file);
  if (!checked.ok) return checked;
  await appendFile(file, `${JSON.stringify(record)}\n`);
  return checked;
}

export async function appendCallLog(root: string, record: CallRecord) {
  try {
    const written = await writeCallLog(root, record);
    if (!written.ok) logError(`Call not logged: ${written.error}`);
  } catch (error) {
    logError(`Call not logged: ${error instanceof Error ? error.message : String(error)}`);
  }
}
