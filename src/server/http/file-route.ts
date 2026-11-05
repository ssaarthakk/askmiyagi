import type { IncomingMessage, ServerResponse } from "node:http";
import type { Side } from "../../shared/anchor.ts";
import type { ViewBase } from "../../shared/diff-base.ts";
import { fileQuerySchema } from "../../shared/file.ts";
import { parseContract } from "../../shared/parse.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { readBaseFile } from "../source/diff-base.ts";
import { sendError } from "./ask-route.ts";

function readSide(root: string, path: string, side: Side | undefined, base: ViewBase | undefined) {
  if (side !== "old" || !base) return readRedactedFile(root, path);
  if (base === "drill") return readRedactedFile(root, path, { withOverlay: false });
  return readBaseFile(root, base, path);
}

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
    const file = await readSide(root, path, side, base);
    if (!file.ok) {
      sendError(response, 400, file.error);
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ path: file.value.relPath, content: file.value.source }));
  };
}
