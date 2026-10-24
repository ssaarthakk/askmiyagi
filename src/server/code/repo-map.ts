import { posix } from "node:path";
import type { Node } from "web-tree-sitter";
import { z } from "zod";
import { listVisibleFiles } from "../files/file-filter.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";
import { grammarsByExtension, hasParser, parseFile } from "./parse-cache.ts";
import { compact, signatureDefinitions } from "./symbols.ts";

type FileEntry = { path: string; signatures: string[] };
type Directory = { name: string; directories: Directory[]; files: FileEntry[]; collapsed: boolean };

const packageSchema = z.object({
  name: z.string().optional(),
  scripts: z.record(z.string(), z.unknown()).optional(),
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
});
type PackageInfo = z.infer<typeof packageSchema> | "invalid";
const configPatterns = [
  /^tsconfig.*\.json$/,
  /^vite\.config\./,
  /^next\.config\./,
  /^biome\.json$/,
  /^eslint\.config\./,
  /^\.eslintrc/,
  /^Dockerfile$/,
  /^docker-compose\./,
  /^compose\./,
  /^\.env\.example$/,
];
const moduleExtensions = Object.keys(grammarsByExtension);
const substitutions: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".js"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

async function signaturesFor(path: string, source: string) {
  const tree = await parseFile(path, source);
  if (!tree) return [];
  return signatureDefinitions(tree.rootNode, path).map(({ signature, container }) =>
    container ? `  ${signature}` : signature,
  );
}

async function relativeImports(path: string, source: string) {
  const tree = await parseFile(path, source);
  if (!tree) return [];
  const imports = new Set<string>();

  function addString(node: Node | null) {
    if (node?.type !== "string") return;
    const value = node.text.slice(1, -1);
    if (value.startsWith("./") || value.startsWith("../")) imports.add(value);
  }

  function visit(node: Node) {
    if (node.type === "import_statement" || node.type === "export_statement") {
      addString(node.namedChildren.find((child) => child.type === "string") ?? null);
    }
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn?.text === "import" || fn?.text === "require") {
        addString(node.childForFieldName("arguments")?.namedChildren[0] ?? null);
      }
    }
    for (const child of node.namedChildren) visit(child);
  }

  visit(tree.rootNode);
  return [...imports];
}

async function importCounts(sources: Map<string, string>, paths: string[]) {
  const counts = new Map(paths.map((path) => [path, 0]));
  for (const [from, source] of sources) {
    const importedPaths = new Set<string>();
    for (const specifier of await relativeImports(from, source)) {
      const target = posix.normalize(posix.join(posix.dirname(from), specifier));
      const extension = posix.extname(target);
      const candidates = extension
        ? [
            target,
            ...(substitutions[extension] ?? []).map(
              (replacement) => `${target.slice(0, -extension.length)}${replacement}`,
            ),
          ]
        : [
            target,
            ...moduleExtensions.map((suffix) => `${target}${suffix}`),
            ...moduleExtensions.map((suffix) => `${target}/index${suffix}`),
          ];
      const resolved = candidates.find((candidate) => counts.has(candidate) && candidate !== from);
      if (resolved) importedPaths.add(resolved);
    }
    for (const path of importedPaths) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

function createTree(files: FileEntry[]) {
  const root: Directory = { name: "", directories: [], files: [], collapsed: false };
  for (const file of files) {
    const segments = file.path.split("/");
    let directory = root;
    for (const name of segments.slice(0, -1)) {
      let child = directory.directories.find((entry) => entry.name === name);
      if (!child) {
        child = { name, directories: [], files: [], collapsed: false };
        directory.directories.push(child);
      }
      directory = child;
    }
    directory.files.push(file);
  }
  return root;
}

function countFiles(directory: Directory): number {
  return (
    directory.files.length +
    directory.directories.reduce((count, child) => count + countFiles(child), 0)
  );
}

function treeLines(directory: Directory, depth = 0): string[] {
  if (!directory.name && directory.collapsed) return [`./ (${countFiles(directory)} files)`];
  const lines: string[] = [];
  for (const child of directory.directories) {
    lines.push(
      `${"  ".repeat(depth)}${child.name}/${child.collapsed ? ` (${countFiles(child)} files)` : ""}`,
    );
    if (!child.collapsed) lines.push(...treeLines(child, depth + 1));
  }
  for (const file of directory.files) {
    lines.push(`${"  ".repeat(depth)}${file.path.split("/").at(-1)}`);
    for (const signature of file.signatures) lines.push(`${"  ".repeat(depth + 1)}${signature}`);
  }
  return lines;
}

function collapseDeepest(root: Directory) {
  let deepest: { directory: Directory; depth: number } | undefined;
  function visit(directory: Directory, depth: number) {
    for (const child of directory.directories) {
      if (child.collapsed) continue;
      if (!deepest || depth > deepest.depth) deepest = { directory: child, depth };
      visit(child, depth + 1);
    }
  }
  visit(root, 1);
  if (deepest) deepest.directory.collapsed = true;
  return deepest !== undefined;
}

function parsePackage(source: string): PackageInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return "invalid";
  }
  const result = packageSchema.safeParse(parsed);
  return result.success ? result.data : "invalid";
}

function render(
  tree: Directory,
  packageInfo: PackageInfo | undefined,
  readme: string | undefined,
  configs: string[],
) {
  const sections = ["## Files", ...treeLines(tree)];
  if (packageInfo === "invalid") sections.push("## package.json", "invalid");
  else if (packageInfo) {
    sections.push("## package.json");
    if (packageInfo.name) sections.push(`name: ${packageInfo.name}`);
    if (packageInfo.scripts)
      sections.push(`scripts: ${Object.keys(packageInfo.scripts).sort().join(", ")}`);
    const dependencies = [
      ...Object.keys(packageInfo.dependencies ?? {}),
      ...Object.keys(packageInfo.devDependencies ?? {}),
    ].sort();
    if (dependencies.length)
      sections.push(`dependencies: ${[...new Set(dependencies)].join(", ")}`);
  }
  if (readme) sections.push("## README", readme);
  sections.push("## Config files", ...configs);
  return sections.join("\n");
}

export async function buildRepoMap(root: string, tokenBudget = 5000): Promise<string> {
  const paths = await listVisibleFiles(root);
  const sources = new Map<string, string>();
  const entries: FileEntry[] = [];
  const readmePath = paths.find((path) => /^readme(?:\.md|\.markdown|\.txt)?$/i.test(path));
  for (const path of paths) {
    const needsSource = hasParser(path) || path === "package.json" || path === readmePath;
    const file = needsSource ? await readRedactedFile(root, path) : null;
    if (file && !file.ok) continue;
    if (file) sources.set(path, file.value.source);
    entries.push({ path, signatures: file ? await signaturesFor(path, file.value.source) : [] });
  }

  const packageSource = sources.get("package.json");
  const packageInfo = packageSource === undefined ? undefined : parsePackage(packageSource);
  const readme = (readmePath && sources.get(readmePath))
    ?.split(/\r?\n\s*\r?\n/)
    .map((paragraph) =>
      compact(
        paragraph
          .split(/\r?\n/)
          .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
          .join(" "),
      ),
    )
    .find(Boolean);
  const configs = paths.filter((path) =>
    configPatterns.some((pattern) => pattern.test(path.split("/").at(-1) ?? "")),
  );
  const counts = await importCounts(sources, paths);
  const tree = createTree(entries);
  const characterBudget = tokenBudget * 4;
  let excess = render(tree, packageInfo, readme, configs).length - characterBudget;
  const leastReferencedFirst = entries.toSorted(
    (left, right) => (counts.get(left.path) ?? 0) - (counts.get(right.path) ?? 0),
  );
  for (const entry of leastReferencedFirst) {
    const indent = 2 * entry.path.split("/").length;
    while (excess > 0 && entry.signatures.length > 0) {
      excess -= indent + (entry.signatures.pop()?.length ?? 0) + 1;
    }
  }
  let output = render(tree, packageInfo, readme, configs);
  while (output.length > characterBudget) {
    if (!collapseDeepest(tree)) {
      if (tree.collapsed) break;
      tree.collapsed = true;
    }
    output = render(tree, packageInfo, readme, configs);
  }
  const redacted = redact(output);
  if (redacted.length <= characterBudget) return redacted;
  return `${redacted.slice(0, characterBudget - 1).trimEnd()}…`;
}
