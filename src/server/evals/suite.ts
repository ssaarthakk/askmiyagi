import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evalSuiteSchema } from "../../shared/eval-suite.ts";
import type { Result } from "../../shared/result.ts";
import { cloneRepository } from "../source/git-clone.ts";
import { isUrl, parseGitHubUrl } from "../source/github-url.ts";
import { type CodeSource, openLocalFolder } from "../source/local-folder.ts";
import { readJsonFile } from "./read-json.ts";

export const projectRoot = resolve(import.meta.dirname, "../../..");

export function loadEvalSuite(file: string) {
  return readJsonFile(file, evalSuiteSchema, "Eval suite");
}

async function openLocalCopy(path: string): Promise<Result<CodeSource>> {
  const source = await openLocalFolder(path);
  if (!source.ok) return source;
  const folder = await mkdtemp(join(tmpdir(), "miyagi-eval-repo-"));
  try {
    await cp(source.value.root, folder, { recursive: true, verbatimSymlinks: true });
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  return {
    ok: true,
    value: {
      root: await realpath(folder),
      dispose: () => rm(folder, { recursive: true, force: true }),
    },
  };
}

async function openClone(url: string, signal: AbortSignal): Promise<Result<CodeSource>> {
  const parsed = parseGitHubUrl(url);
  return parsed.ok ? cloneRepository(parsed.value, signal) : parsed;
}

export function openSuiteRepo(repo: string, signal: AbortSignal): Promise<Result<CodeSource>> {
  return isUrl(repo) ? openClone(repo, signal) : openLocalCopy(resolve(projectRoot, repo));
}
