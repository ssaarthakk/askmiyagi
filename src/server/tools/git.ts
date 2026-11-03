import type { z } from "zod";
import { gitInputSchema } from "../../shared/tool-inputs.ts";
import type { ToolResult } from "../../shared/tool-result.ts";
import { isVisibleInDiff, readProjectConfig } from "../files/file-filter.ts";
import { withoutVoiceKey } from "../llm/claude-process.ts";
import { runGit } from "../source/git-process.ts";
import { runTool, toolResult } from "./run-tool.ts";

type GitInput = z.output<typeof gitInputSchema>;
type GitContext = { root: string; config: string[]; signal: AbortSignal };
type Listing = { hidden: Set<string>; checked: Set<string> };

const timeoutMs = 30_000;
const maximumLines = 200;
const defaultLogCount = 50;
const maximumExcludeLength = 20_000;
const maximumListingRounds = 10;
const narrowHint = "narrow it with paths after --";
const lockedDownConfig = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "log.showSignature=false",
];
const filterAttribute = /(?:^|\s)filter=(\S+)/g;
const filterName = /^[\w.-]+$/;

function gitEnvironment() {
  const inherited = Object.entries(withoutVoiceKey(process.env)).filter(
    ([name]) => !name.toUpperCase().startsWith("GIT_"),
  );
  return { ...Object.fromEntries(inherited), GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
}

async function filterOverrides(root: string) {
  const attributes = (await readProjectConfig(root, ".gitattributes")) ?? "";
  const named = [...attributes.matchAll(filterAttribute)].map((match) => match[1] ?? "");
  return [...new Set(["lfs", ...named])].flatMap((name) => {
    if (!filterName.test(name)) throw new Error(`Unusual filter name in .gitattributes: ${name}`);
    return [
      "-c",
      `filter.${name}.clean=`,
      "-c",
      `filter.${name}.process=`,
      "-c",
      `filter.${name}.required=false`,
    ];
  });
}

function git({ root, config, signal }: GitContext, args: string[]) {
  return runGit([...config, ...args], { cwd: root, env: gitEnvironment(), signal });
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

async function findsNewHiddenPaths(context: GitContext, input: GitInput, listing: Listing) {
  const nameOptions =
    input.command === "diff"
      ? ["--name-only", "-z"]
      : ["--format=", "--name-only", "-z", ...countOptions(input)];
  const run = await git(context, [
    ...diffOptions(input.command),
    ...nameOptions,
    ...input.args.revisions,
    ...pathspec(input.args.paths, listing.hidden),
  ]);
  if (run.truncated) throw new Error(`Too many changed files; ${narrowHint}`);
  const hiddenBefore = listing.hidden.size;
  for (const path of run.stdout.split("\0")) {
    if (!path || listing.checked.has(path)) continue;
    listing.checked.add(path);
    if (!(await isVisibleInDiff(context.root, path))) listing.hidden.add(path);
  }
  return listing.hidden.size > hiddenBefore;
}

async function hiddenPaths(context: GitContext, input: GitInput) {
  const listing: Listing = { hidden: new Set(), checked: new Set() };
  for (let round = 0; round < maximumListingRounds; round += 1) {
    if (!(await findsNewHiddenPaths(context, input, listing))) return listing;
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
  const config = [...lockedDownConfig, ...(await filterOverrides(root))];
  const context: GitContext = { root, config, signal: AbortSignal.timeout(timeoutMs) };
  const listing = await hiddenPaths(context, input);
  const { flags, revisions, paths } = input.args;
  const run = await git(context, [
    ...diffOptions(input.command),
    ...flags,
    ...countOptions(input),
    ...revisions,
    ...pathspec(paths, listing.hidden),
  ]);
  if (await findsNewHiddenPaths(context, input, listing)) {
    throw new Error("Files changed while git was reading them; try again");
  }
  return toolResult(limitLines(run.stdout, run.truncated) || "No changes.");
}

export function gitTool(root: string, input: unknown): Promise<ToolResult> {
  return runTool(root, "git", gitInputSchema, input, (parsed) => runGitTool(root, parsed));
}
