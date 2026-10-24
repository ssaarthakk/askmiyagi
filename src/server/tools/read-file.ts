import { z } from "zod";
import type { ToolResult } from "../../shared/tool-result.ts";
import { parseFile } from "../code/parse-cache.ts";
import {
  lineRange,
  type SymbolDefinition,
  signatureDefinitions,
  uniqueDefinition,
} from "../code/symbols.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { runTool, toolResult } from "./run-tool.ts";

const inputSchema = z
  .object({
    path: z.string().min(1),
    start: z.number().int().positive().optional(),
    end: z.number().int().positive().optional(),
    symbol: z.string().min(1).optional(),
  })
  .refine((input) => !(input.symbol && (input.start !== undefined || input.end !== undefined)), {
    message: "symbol cannot be combined with a line range",
  });

type ReadFileInput = z.infer<typeof inputSchema>;

function boundedLines(lines: string[], start: number, end: number) {
  const shownEnd = Math.min(end, start + 249);
  const output = lines.slice(start - 1, shownEnd).map((line, index) => `${start + index}: ${line}`);
  if (shownEnd < end) output.push(`showing ${start}–${shownEnd} of ${lines.length}`);
  return output.join("\n");
}

function outline(definitions: SymbolDefinition[]) {
  const entries = definitions.map(({ node, signature }) => `${lineRange(node)}: ${signature}`);
  const output = entries.slice(0, 250);
  if (entries.length > output.length) output.push(`showing 1–250 of ${entries.length}`);
  return output.join("\n");
}

async function read(root: string, input: ReadFileInput): Promise<ToolResult> {
  const file = await readRedactedFile(root, input.path);
  if (!file.ok) return toolResult(file.error, true);

  const { relPath, source } = file.value;
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return toolResult("(empty file)");
  const tree = await parseFile(relPath, source);

  const { symbol } = input;
  if (symbol) {
    const found = tree
      ? uniqueDefinition(tree.rootNode, relPath, symbol)
      : { ok: false as const, error: `Symbol not found: ${symbol}` };
    if (!found.ok) return toolResult(found.error, true);
    const { startPosition, endPosition } = found.value.node;
    return toolResult(boundedLines(lines, startPosition.row + 1, endPosition.row + 1));
  }

  const start = input.start ?? 1;
  const requestedEnd = input.end ?? lines.length;
  const end = Math.min(requestedEnd, lines.length);
  if (start > lines.length || start > requestedEnd) {
    return toolResult(
      `Invalid line range: ${start}-${requestedEnd} for ${lines.length} lines`,
      true,
    );
  }

  if (tree && input.start === undefined && input.end === undefined && lines.length > 400) {
    const definitions = signatureDefinitions(tree.rootNode, relPath);
    if (definitions.length > 0) return toolResult(outline(definitions));
  }

  return toolResult(boundedLines(lines, start, end));
}

export function readFileTool(root: string, input: unknown): Promise<ToolResult> {
  return runTool(root, "read_file", inputSchema, input, (parsed) => read(root, parsed));
}
