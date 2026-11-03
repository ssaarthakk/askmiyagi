import { readFile, stat } from "node:fs/promises";
import { SourceMap } from "node:module";
import { posix } from "node:path";
import type { Node } from "web-tree-sitter";
import { z } from "zod";
import { type GuardedPath, guardPath, readRedactedFile, sourceLines } from "../files/path-guard.ts";
import { logError } from "../log.ts";
import { parseFile } from "./parse-cache.ts";

export type Frame = {
  function?: string;
  file: string;
  line: number;
  column: number;
  warning?: string;
};

const generatedScript = /\.[cm]?js$/i;
const sourceMapComment = /\/\/[#@] sourceMappingURL=(\S+)\s*$/;
const sourceMapFile = /\.map$/i;
const maximumReadBytes = 10 * 1024 * 1024;
const sourceMapSchema = z.object({
  version: z.number(),
  file: z.string().default(""),
  sourceRoot: z.string().default(""),
  sources: z.array(z.string()),
  names: z.array(z.string()).default([]),
  mappings: z.string(),
});
const functionLike =
  /^(?:function_declaration|generator_function_declaration|function_expression|generator_function|arrow_function|method_definition|class_declaration|abstract_class_declaration|class)$/;
const assignedName = /(?:^|[.\]])([\w$]+)\s*$/;

async function locate(root: string, file: string) {
  const segments = file
    .replace(/^[a-z][a-z\d+.-]*:\/\/[^/]*/i, "")
    .replace(/\?.*$/, "")
    .split(/[\\/]/)
    .filter((segment) => segment && !segment.includes(":"));
  for (let start = 0; start < segments.length; start += 1) {
    const path = segments.slice(start).join("/");
    const script = generatedScript.test(path);
    const guarded = await guardPath(root, path, { filtered: !script });
    if (guarded.ok && (!script || (await isGeneratedScript(guarded.value)))) return guarded.value;
  }
  return undefined;
}

async function isGeneratedScript({ realPath, relPath }: GuardedPath) {
  return generatedScript.test(relPath) && (await stat(realPath)).isFile();
}

async function readSmallFile(realPath: string) {
  const info = await stat(realPath);
  return info.isFile() && info.size <= maximumReadBytes ? readFile(realPath, "utf8") : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readSourceMap(root: string, generated: GuardedPath) {
  if (!generatedScript.test(generated.relPath)) return undefined;
  let mapPath = generated.relPath;
  try {
    const script = await readSmallFile(generated.realPath);
    const url = script && sourceMapComment.exec(script)?.[1];
    if (!url || url.startsWith("data:")) return undefined;
    mapPath = posix.join(posix.dirname(generated.relPath), decodeURI(url));
    if (!sourceMapFile.test(mapPath)) {
      logError(`Source map ${mapPath} not used: not a .map file`);
      return undefined;
    }
    const guarded = await guardPath(root, mapPath, { filtered: false });
    if (!guarded.ok) {
      logError(`Source map ${mapPath} not used: ${guarded.error}`);
      return undefined;
    }
    const content = await readSmallFile(guarded.value.realPath);
    const json = content === undefined ? undefined : parseJson(content);
    if (json === undefined) {
      logError(`Source map ${mapPath} not used: not valid JSON or over 10 MB`);
      return undefined;
    }
    const parsed = sourceMapSchema.safeParse(json);
    if (!parsed.success) {
      logError(`Source map ${mapPath} not used: ${z.prettifyError(parsed.error)}`);
      return undefined;
    }
    return {
      mapPath,
      sourceRoot: parsed.data.sourceRoot,
      map: new SourceMap({ ...parsed.data, sourcesContent: [] }),
    };
  } catch (error) {
    logError(`Source map ${mapPath} not used: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function original(root: string, generated: GuardedPath, frame: Frame) {
  const found = await readSourceMap(root, generated);
  const entry = found?.map.findEntry(frame.line - 1, frame.column - 1);
  if (!found || !entry || !("originalSource" in entry)) return undefined;
  const file = posix.join(posix.dirname(found.mapPath), found.sourceRoot, entry.originalSource);
  return {
    file,
    line: entry.originalLine + 1,
    column: entry.originalColumn + 1,
  };
}

function wantedName(name: string | undefined) {
  const last = name
    ?.replace(/\s*\[as [^\]]*\]$/, "")
    .replace(/^(?:new|async)\s+/, "")
    .split(".")
    .at(-1);
  return last && /^[\w$]+$/.test(last) ? last : undefined;
}

function namesOf(node: Node) {
  const own = node.childForFieldName("name")?.text;
  if (own) return [own];
  const parent = node.parent;
  const target =
    parent?.childForFieldName("name") ??
    parent?.childForFieldName("key") ??
    parent?.childForFieldName("left");
  const assigned = target && assignedName.exec(target.text)?.[1];
  return assigned ? [assigned] : [];
}

async function warningFor(file: string, source: string, line: number, name: string | undefined) {
  const wanted = wantedName(name);
  if (!wanted) return undefined;
  const lines = sourceLines(source);
  const text = lines[line - 1];
  const tree = text === undefined ? null : await parseFile(file, source);
  const names: string[] = [];
  if (tree && text !== undefined) {
    let node = tree.rootNode.descendantForPosition(
      { row: line - 1, column: text.length - text.trimStart().length },
      { row: line - 1, column: text.trimEnd().length },
    );
    while (node) {
      if (functionLike.test(node.type)) names.push(...namesOf(node));
      node = node.parent;
    }
  }
  const unverifiable = text !== undefined && !tree;
  return unverifiable || names.includes(wanted) ? undefined : `${name} is not at ${file}:${line}`;
}

export async function anchorFrame(root: string, frame: Frame): Promise<Frame | undefined> {
  const generated = await locate(root, frame.file);
  if (!generated) return undefined;
  const mapped = await original(root, generated, frame);
  const target = mapped ?? { file: generated.relPath, line: frame.line, column: frame.column };
  const read = await readRedactedFile(root, target.file);
  if (!read.ok) {
    if (mapped) logError(`No source for ${target.file}: ${read.error}`);
    return undefined;
  }
  const warning = await warningFor(
    read.value.relPath,
    read.value.source,
    target.line,
    frame.function,
  );
  return { ...target, file: read.value.relPath, ...(warning ? { warning } : {}) };
}
