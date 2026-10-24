import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { Language, Parser, type Tree } from "web-tree-sitter";

type Grammar = "typescript" | "tsx" | "javascript";

const require = createRequire(import.meta.url);
const grammarPaths: Record<Grammar, string> = {
  typescript: require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"),
  tsx: require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"),
  javascript: require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"),
};
const treeCache = new Map<string, Promise<Tree>>();
const languageCache = new Map<Grammar, Promise<Language>>();
let parserInitialization: Promise<void> | undefined;

export const grammarsByExtension: Record<string, Grammar> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mjs": "javascript",
  ".cjs": "javascript",
};

function grammarFor(path: string) {
  return grammarsByExtension[extname(path)] ?? null;
}

export function hasParser(path: string) {
  return grammarFor(path) !== null;
}

async function loadLanguage(grammar: Grammar) {
  let language = languageCache.get(grammar);
  if (!language) {
    language = Language.load(grammarPaths[grammar]);
    languageCache.set(grammar, language);
  }
  return language;
}

async function parse(source: string, grammar: Grammar) {
  parserInitialization ??= Parser.init();
  await parserInitialization;

  const parser = new Parser();
  try {
    parser.setLanguage(await loadLanguage(grammar));
    const tree = parser.parse(source);
    if (tree === null) throw new Error("Tree-sitter returned no parse tree");
    return tree;
  } finally {
    parser.delete();
  }
}

export async function parseFile(path: string, source: string): Promise<Tree | null> {
  const grammar = grammarFor(path);
  if (grammar === null) return null;

  const hash = createHash("sha256").update(source).digest("hex");
  const key = `${grammar}:${hash}`;
  const cachedTree = treeCache.get(key);
  if (cachedTree) return cachedTree;

  const pendingTree = parse(source, grammar).catch((error: unknown) => {
    if (treeCache.get(key) === pendingTree) treeCache.delete(key);
    throw error;
  });
  treeCache.set(key, pendingTree);
  return pendingTree;
}
