import type { z } from "zod";
import { gitInputSchema } from "../../shared/tool-inputs.ts";
import type { ToolResult } from "../../shared/tool-result.ts";
import { isVisibleInDiff } from "../files/file-filter.ts";
import { withoutVoiceKey } from "../llm/claude-process.ts";
import { runGit } from "../source/git-process.ts";
import { runTool, toolResult } from "./run-tool.ts";

type GitInput = z.output<typeof gitInputSchema>;

const timeoutMs = 30_000;
const maximumLines = 200;
const defaultLogCount = 50;
const maximumExcludeLength = 20_000;
const maximumListingRounds = 10;
const narrowHint = "narrow it with paths after --";

function git(root: string, args: string[], signal: AbortSignal) {
  return runGit(
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotepath=false",
      "-c",
      "log.showSignature=false",
      ...args,
    ],
    { cwd: root, env: gitEnvironment(), signal },
  );
}

function gitEnvironment() {
  const inherited = Object.entries(withoutVoiceKey(process.env)).filter(
    ([name]) => !name.toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(inherited), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
}

function diffOptions(command: GitInput["command"]) {
  return [command, "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--relative"];
}

function countOptions({ command, args }: GitInput) {
  const limit = args.count ?? (command === "log" ? defaultLogCount : undefined);
  return limit === undefined ? [] : ["-n", String(limit)];
}

function pathspec(paths: string[], hidden: Set<string>) {
  const excludes = [...hidden].map((path) => `:(exclude,literal)${path}`);
  if (excludes.join("").length > maximumExcludeLength) {
    throw new Error(`Too many hidden files in this change; ${narrowHint}`);
  }
  return ["--", ...(paths.length > 0 ? paths : ["."]), ...excludes];
}

async function hiddenPaths(root: string, input: GitInput, signal: AbortSignal) {
  const listing =
    input.command === "diff"
      ? ["--name-only", "-z"]
      : ["--format=", "--name-only", "-z", ...countOptions(input)];
  const hidden = new Set<string>();
  const checked = new Set<string>();
  for (let round = 0; round < maximumListingRounds; round += 1) {
    const run = await git(
      root,
      [
        ...diffOptions(input.command),
        ...listing,
        ...input.args.revisions,
        ...pathspec(input.args.paths, hidden),
      ],
      signal,
    );
    if (run.truncated) throw new Error(`Too many changed files; ${narrowHint}`);
    const hiddenBefore = hidden.size;
    for (const path of run.stdout.split("\0")) {
      if (!path || checked.has(path)) continue;
      checked.add(path);
      if (!(await isVisibleInDiff(root, path))) hidden.add(path);
    }
    if (hidden.size === hiddenBefore) return hidden;
  }
  throw new Error(`Too many hidden files in this change; ${narrowHint}`);
}

function limitLines(text: string, truncated: boolean) {
  const lines = text.replace(/\n+$/, "").split("\n");
  if (truncated) lines.pop();
  const extra = lines.length - maximumLines;
  if (!truncated && extra <= 0) return lines.join("\n");
  const note = truncated ? "More lines were cut" : `${extra} more lines`;
  return [...lines.slice(0, maximumLines), note].join("\n");
}

async function runGitTool(root: string, input: GitInput): Promise<ToolResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  const hidden = await hiddenPaths(root, input, signal);
  const { flags, revisions, paths } = input.args;
  const run = await git(
    root,
    [
      ...diffOptions(input.command),
      ...flags,
      ...countOptions(input),
      ...revisions,
      ...pathspec(paths, hidden),
    ],
    signal,
  );
  return toolResult(limitLines(run.stdout, run.truncated) || "No changes.");
}

export function gitTool(root: string, input: unknown): Promise<ToolResult> {
  return runTool(root, "git", gitInputSchema, input, (parsed) => runGitTool(root, parsed));
}
