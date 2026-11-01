import type { ServerResponse } from "node:http";
import { visibleDefinitions } from "../code/visible-definitions.ts";

const maxSymbols = 5000;

export function createSymbolsHandler(root: string) {
  return async function handleSymbols(response: ServerResponse) {
    const names = new Set<string>();
    for await (const { definition } of visibleDefinitions(root)) names.add(definition.name);
    const symbols = [...names].sort().slice(0, maxSymbols);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ symbols }));
  };
}
