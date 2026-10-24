import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rgPath } from "@vscode/ripgrep";
import ignore from "ignore";
import { z } from "zod";
import type { ToolResult } from "../../shared/tool-result.ts";
import { listVisibleFiles } from "../files/file-filter.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { runTool, toolResult } from "./run-tool.ts";

const inputSchema = z.object({
  patterns: z.array(z.string().min(1)).min(1),
  caseInsensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  include: z.array(z.string().min(1)).min(1).optional(),
  exclude: z.array(z.string().min(1)).optional(),
});
const eventSchema = z.object({ type: z.string(), data: z.unknown() });
const matchSchema = z.object({
  line_number: z.number().int().positive(),
  lines: z.object({ text: z.string() }),
});

type GrepInput = z.infer<typeof inputSchema>;
type Match = { path: string; line: number; text: string };
type Segment = { path: string; lastLine: number };
const timeoutSeconds = 30;

function isTestPath(path: string) {
  return /(?:\.test\.|\.spec\.|__tests__\/|(?:^|\/)test\/)/.test(path);
}

function comparePaths(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareMatches(left: Match, right: Match) {
  const testOrder = Number(isTestPath(left.path)) - Number(isTestPath(right.path));
  return testOrder || comparePaths(left.path, right.path) || left.line - right.line;
}

function shortLine(line: string) {
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function searchedFiles(files: string[], input: GrepInput) {
  const include = input.include && ignore().add(input.include);
  const exclude = ignore().add(input.exclude ?? []);
  return files.filter((path) => (!include || include.ignores(path)) && !exclude.ignores(path));
}

async function* redactedFiles(root: string, files: string[], segments: Segment[]) {
  let lastLine = 0;
  for (const path of files) {
    const file = await readRedactedFile(root, path);
    if (!file.ok || !file.value.source) continue;
    const { source } = file.value;
    const text = source.endsWith("\n") ? source : `${source}\n`;
    lastLine += text.split("\n").length - 1;
    segments.push({ path: file.value.relPath, lastLine });
    yield text;
  }
}

async function runRipgrep(
  root: string,
  input: GrepInput,
  files: string[],
  signal: AbortSignal,
  onMatch: (line: number, text: string, segments: Segment[]) => void,
) {
  const args = ["--no-config", "--json"];
  if (input.caseInsensitive) args.push("--ignore-case");
  if (input.wholeWord) args.push("--word-regexp");
  args.push("-e", input.patterns.join("|"), "-");

  const child = spawn(rgPath, args, { cwd: root, shell: false, windowsHide: true, signal });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  let failure: unknown;
  child.on("error", (error) => {
    failure ??= error;
  });
  const exit = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 2)));
  const segments: Segment[] = [];
  const written = pipeline(Readable.from(redactedFiles(root, files, segments)), child.stdin).then(
    () => null,
    (error: unknown) => error,
  );
  const readEvents = async () => {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      const event = eventSchema.parse(JSON.parse(line));
      if (event.type !== "match") continue;
      const data = matchSchema.parse(event.data);
      onMatch(data.line_number, data.lines.text.replace(/\r?\n$/, ""), segments);
    }
  };
  const events = readEvents().catch((error: unknown) => {
    failure ??= error;
    child.kill();
  });
  const [code, writeError] = await Promise.all([exit, written, events]);
  if (failure) throw failure;
  if (code <= 1 && writeError) throw writeError;
  return { code, stderr };
}

async function search(root: string, input: GrepInput): Promise<ToolResult> {
  const matches: Match[] = [];
  const fileCounts = new Map<string, number>();
  let totalMatches = 0;
  let segment = 0;

  function onMatch(line: number, text: string, segments: Segment[]) {
    while ((segments[segment]?.lastLine ?? Infinity) < line) segment += 1;
    const path = segments[segment]?.path ?? "";
    const firstLine = (segments[segment - 1]?.lastLine ?? 0) + 1;
    totalMatches += 1;
    fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
    matches.push({ path, line: line - firstLine + 1, text });
    matches.sort(compareMatches);
    if (matches.length > 50) matches.pop();
  }

  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  try {
    const files = searchedFiles(await listVisibleFiles(root), input);
    const output = await runRipgrep(root, input, files, signal, onMatch);
    if (output.code > 1) return toolResult(output.stderr.trim() || "Search failed", true);
  } catch (error) {
    if (signal.aborted) return toolResult(`Search timed out after ${timeoutSeconds} s`, true);
    throw error;
  }

  if (totalMatches === 0) return toolResult("No matches.");
  const lines: string[] = [];
  for (const [index, match] of matches.entries()) {
    if (matches[index - 1]?.path !== match.path) lines.push(match.path);
    lines.push(`  ${match.line}: ${shortLine(match.text)}`);
  }
  if (totalMatches > 50) {
    lines.push(`50 of ${totalMatches}`, "Matches by file:");
    for (const path of [...fileCounts.keys()].sort()) {
      lines.push(`${path}: ${fileCounts.get(path)}`);
    }
  }
  return toolResult(lines.join("\n"));
}

export function grepTool(root: string, input: unknown): Promise<ToolResult> {
  return runTool(root, "grep", inputSchema, input, (parsed) => search(root, parsed));
}
