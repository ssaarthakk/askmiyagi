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

function collapsed(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function nearestLine(lines: string[], line: number, matches: (candidate: string) => boolean) {
  let nearest: number | undefined;
  lines.forEach((candidate, index) => {
    const number = index + 1;
    if (
      matches(candidate) &&
      (nearest === undefined || Math.abs(number - line) < Math.abs(nearest - line))
    ) {
      nearest = number;
    }
  });
  return nearest;
}

function nearestMatchingLine(lines: string[], line: number, text: string) {
  const wanted = collapsed(text);
  return (
    nearestLine(lines, line, (candidate) => collapsed(candidate) === wanted) ??
    (wanted.length >= 8
      ? nearestLine(lines, line, (candidate) => collapsed(candidate).includes(wanted))
      : undefined)
  );
}

function declarationPatterns(name: string) {
  const word = `(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`;
  const modifiers = "(export\\s+|async\\s+|static\\s+|public\\s+|private\\s+|protected\\s+)*";
  return [
    new RegExp(`\\b(function|class|interface|type|enum|const|let|var|def|fn|func)\\s+${word}`),
    new RegExp(`^\\s*${modifiers}${word}\\s*[(<].*(\\{|=>)\\s*$`),
    new RegExp(`${word}\\s*[:=]\\s*(async\\s*)?(\\(|function\\b)`),
    new RegExp(`^(?!\\s*import\\b).*${word}`),
  ];
}

function declarationLine(lines: string[], symbol: string) {
  const names = symbol.split(".");
  if (!names.every((name) => /^[\w$]+$/.test(name))) return undefined;
  let from = 0;
  if (names.length > 1) {
    const [owner] = declarationPatterns(names.at(-2) ?? "");
    from = lines.findIndex((candidate) => owner?.test(candidate));
    if (from === -1) return undefined;
  }
  for (const pattern of declarationPatterns(names.at(-1) ?? "")) {
    const index = lines.findIndex((candidate, at) => at >= from && pattern.test(candidate));
    if (index !== -1) return index + 1;
  }
  return undefined;
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
    const symbol = anchor.symbol.trim();
    const found = tree ? uniqueDefinition(tree.rootNode, relPath, symbol) : undefined;
    if (found?.ok) {
      const { startPosition, endPosition } = found.value.node;
      return block(relPath, startPosition.row + 1, endPosition.row + 1);
    }
    const lines = source.split("\n");
    const line = declarationLine(lines, symbol);
    if (line === undefined) {
      return found ?? { ok: false, error: `Symbol not found in ${relPath}: ${symbol}` };
    }
    const statement = tree && enclosingStatement(tree, lines[line - 1] ?? "", line);
    return statement
      ? block(relPath, statement.startPosition.row + 1, statement.endPosition.row + 1, line)
      : block(relPath, line, line);
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
