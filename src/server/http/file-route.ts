import type { IncomingMessage, ServerResponse } from "node:http";
import { readRedactedFile } from "../files/path-guard.ts";
import { sendError } from "./ask-route.ts";

export function createFileHandler(root: string) {
  return async function handleFile(request: IncomingMessage, response: ServerResponse) {
    const path = new URL(request.url ?? "/", "http://localhost").searchParams.get("path") ?? "";
    const file = await readRedactedFile(root, path);
    if (!file.ok) {
      sendError(response, 400, file.error);
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ path: file.value.relPath, content: file.value.source }));
  };
}
