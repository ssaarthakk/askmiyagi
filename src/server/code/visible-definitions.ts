import { listVisibleFiles } from "../files/file-filter.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { hasParser, parseFile } from "./parse-cache.ts";
import { findDefinitions } from "./symbols.ts";

export async function* visibleDefinitions(root: string) {
  for (const path of (await listVisibleFiles(root)).filter(hasParser)) {
    const file = await readRedactedFile(root, path);
    if (!file.ok) continue;
    const tree = await parseFile(file.value.relPath, file.value.source);
    for (const definition of tree ? findDefinitions(tree.rootNode, file.value.relPath) : []) {
      yield { path: file.value.relPath, definition };
    }
  }
}
