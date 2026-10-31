import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type EvalSuite, evalSuiteSchema } from "../../shared/eval-suite.ts";
import { parseContract } from "../../shared/parse.ts";
import type { Result } from "../../shared/result.ts";
import { openGitClone } from "../source/git-clone.ts";
import { type CodeSource, openLocalFolder } from "../source/local-folder.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");

export async function loadEvalSuite(file: string): Promise<Result<EvalSuite>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { ok: false, error: `Eval suite not found: ${file}` };
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `${file}\nnot valid JSON` };
  }
  const parsed = parseContract(evalSuiteSchema, json);
  return parsed.ok ? parsed : { ok: false, error: `${file}\n${parsed.error}` };
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

export function openSuiteRepo(repo: string, signal: AbortSignal): Promise<Result<CodeSource>> {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(repo)
    ? openGitClone(repo, signal)
    : openLocalCopy(resolve(projectRoot, repo));
}
