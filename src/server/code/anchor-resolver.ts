import type { Tree } from "web-tree-sitter";
import type { Anchor, ResolvedAnchor } from "../../shared/anchor.ts";
import type { Result } from "../../shared/result.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { parseFile } from "./parse-cache.ts";
import { uniqueDefinition } from "./symbols.ts";

const maxBlockLines = 40;
const statementOrDeclaration = /(_statement|_declaration|_definition|_signature)$/;

function block(file: string, start: number, end: number, line = start): Result<ResolvedAnchor> {
  const shownStart = Math.max(start, line - maxBlockLines + 1);
  return {
    ok: true,
    value: {
      file,
      start: shownStart,
      end: Math.min(end, shownStart + maxBlockLines - 1),
      capped: end - start + 1 > maxBlockLines,
    },
  };
}

function nearestMatchingLine(lines: string[], line: number, text: string) {
  let nearest: number | undefined;
  lines.forEach((candidate, index) => {
    const number = index + 1;
    if (
      candidate.trim() === text &&
      (nearest === undefined || Math.abs(number - line) < Math.abs(nearest - line))
    ) {
      nearest = number;
    }
  });
  return nearest;
}

function enclosingStatement(tree: Tree, text: string, line: number) {
  const row = line - 1;
  let node = tree.rootNode.descendantForPosition(
    { row, column: text.length - text.trimStart().length },
    { row, column: text.trimEnd().length },
  );
  while (node && !statementOrDeclaration.test(node.type)) node = node.parent;
  return node;
}

export async function resolveAnchor(root: string, anchor: Anchor): Promise<Result<ResolvedAnchor>> {
  const file = await readRedactedFile(root, anchor.file);
  if (!file.ok) return file;
  const { relPath, source } = file.value;
  const tree = await parseFile(relPath, source);

  if ("symbol" in anchor) {
    if (!tree) return { ok: false, error: `No parser for ${relPath}; anchor it by line and text` };
    const found = uniqueDefinition(tree.rootNode, relPath, anchor.symbol.trim());
    if (!found.ok) return found;
    const { startPosition, endPosition } = found.value.node;
    return block(relPath, startPosition.row + 1, endPosition.row + 1);
  }

  const text = anchor.text.trim();
  if (!text) return { ok: false, error: "Anchor text is empty" };
  const lines = source.split("\n");
  const line = nearestMatchingLine(lines, anchor.line, text);
  if (line === undefined) return { ok: false, error: `Text not found in ${relPath}: ${text}` };
  const statement = tree && enclosingStatement(tree, lines[line - 1] ?? "", line);
  return statement
    ? block(relPath, statement.startPosition.row + 1, statement.endPosition.row + 1, line)
    : block(relPath, line, line);
}
