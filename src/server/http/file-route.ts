import type { IncomingMessage, ServerResponse } from "node:http";
import { fileQuerySchema } from "../../shared/file.ts";
import { parseContract } from "../../shared/parse.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { readBaseFile } from "../source/diff-base.ts";
import { sendError } from "./ask-route.ts";

export function createFileHandler(root: string) {
  return async function handleFile(request: IncomingMessage, response: ServerResponse) {
    const parameters = new URL(request.url ?? "/", "http://localhost").searchParams;
    const query = parseContract(fileQuerySchema, {
      path: parameters.get("path") ?? "",
      side: parameters.get("side") ?? undefined,
      base: parameters.get("base") ?? undefined,
    });
    if (!query.ok) {
      sendError(response, 400, query.error);
      return;
    }
    const { path, side, base } = query.value;
    const file =
      side === "old" && base
        ? await readBaseFile(root, base, path)
        : await readRedactedFile(root, path);
    if (!file.ok) {
      sendError(response, 400, file.error);
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ path: file.value.relPath, content: file.value.source }));
  };
}
