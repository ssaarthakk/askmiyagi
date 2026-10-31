import type { CallRecord } from "../../shared/call-log.ts";
import type { EvalCase } from "../../shared/eval-suite.ts";
import { guardPath } from "../files/path-guard.ts";

type FailedRun = {
  checks: Record<string, boolean | number>;
  filesOpened: string[];
  mode: CallRecord["mode"];
};

async function relativePath(root: string, path: string) {
  const guarded = await guardPath(root, path);
  return guarded.ok ? guarded.value.relPath : path;
}

export async function classifyFailure(root: string, evalCase: EvalCase, run: FailedRun) {
  if (!Object.values(run.checks).includes(false)) return undefined;
  if (!run.checks.validJson) return "reasoning-miss" as const;
  if (run.mode === "brute-force") return "reasoning-miss" as const;
  const opened = new Set(
    await Promise.all(run.filesOpened.map((path) => relativePath(root, path))),
  );
  const wanted = await Promise.all(
    evalCase.mustHighlight.map((reference) => relativePath(root, reference.split("#")[0] ?? "")),
  );
  return wanted.every((file) => opened.has(file))
    ? ("reasoning-miss" as const)
    : ("retrieval-miss" as const);
}
