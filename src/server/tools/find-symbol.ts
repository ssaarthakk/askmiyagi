import { z } from "zod";
import type { ToolResult } from "../../shared/tool-result.ts";
import { hasParser, parseFile } from "../code/parse-cache.ts";
import { findDefinitions, lineRange, matchesName, symbolKinds } from "../code/symbols.ts";
import { listVisibleFiles } from "../files/file-filter.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { runTool, toolResult } from "./run-tool.ts";

const inputSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(symbolKinds).optional(),
});

async function find(
  root: string,
  { name, kind }: z.infer<typeof inputSchema>,
): Promise<ToolResult> {
  const matches: string[] = [];
  for (const path of (await listVisibleFiles(root)).filter(hasParser)) {
    const file = await readRedactedFile(root, path);
    if (!file.ok) continue;
    const tree = await parseFile(file.value.relPath, file.value.source);
    for (const definition of tree ? findDefinitions(tree.rootNode, file.value.relPath) : []) {
      if (matchesName(definition, name) && (kind === undefined || definition.kind === kind)) {
        matches.push(
          `${definition.kind} ${definition.qualifiedName} ${file.value.relPath}:${lineRange(definition.node)}`,
        );
      }
    }
  }
  if (matches.length === 0) {
    const qualifier = kind ? ` with kind '${kind}'` : "";
    return toolResult(`No symbols found for '${name}'${qualifier}. Try a broader name.`);
  }
  const shown = matches.slice(0, 50);
  if (matches.length > shown.length) shown.push(`50 of ${matches.length}`);
  return toolResult(shown.join("\n"));
}

export function findSymbolTool(root: string, input: unknown): Promise<ToolResult> {
  return runTool(root, "find_symbol", inputSchema, input, (parsed) => find(root, parsed));
}
