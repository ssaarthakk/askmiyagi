import { readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { type createAskHandler, sendError } from "./ask-route.ts";
import type { createFileHandler } from "./file-route.ts";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

function sendNotFound(response: ServerResponse) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

export async function serveRequest(
  request: IncomingMessage,
  response: ServerResponse,
  webRoot: string,
  page: string,
  token: string,
  port: number,
  handleAsk: ReturnType<typeof createAskHandler>,
  handleFile: ReturnType<typeof createFileHandler>,
) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(request.headers.host?.toLowerCase() ?? "")) {
    sendError(response, 403, "Forbidden host");
    return;
  }
  const origin = request.headers.origin;
  if (origin && !allowedHosts.some((host) => `http://${host}` === origin)) {
    sendError(response, 403, "Forbidden origin");
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent((request.url ?? "/").split("?", 1)[0] || "/");
  } catch {
    sendNotFound(response);
    return;
  }
  if (
    (pathname === "/api" || pathname.startsWith("/api/")) &&
    request.headers["x-miyagi-token"] !== token
  ) {
    sendError(response, 401, "Unauthorized");
    return;
  }
  if (pathname === "/api/ask" && request.method === "POST") {
    await handleAsk(request, response);
    return;
  }
  if (pathname === "/api/file" && request.method === "GET") {
    await handleFile(request, response);
    return;
  }
  if (request.method !== "GET") {
    sendNotFound(response);
    return;
  }
  if (pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
    return;
  }

  const filePath = resolve(webRoot, `.${pathname}`);
  const relativePath = relative(webRoot, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    sendNotFound(response);
    return;
  }

  try {
    const resolvedPath = await realpath(filePath);
    const resolvedRelativePath = relative(webRoot, resolvedPath);
    if (
      resolvedRelativePath === ".." ||
      resolvedRelativePath.startsWith(`..${sep}`) ||
      isAbsolute(resolvedRelativePath)
    ) {
      sendNotFound(response);
      return;
    }
    const content = await readFile(resolvedPath);
    response.writeHead(200, {
      "content-type":
        contentTypes[extname(resolvedPath).toLowerCase()] ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" ||
        error.code === "ENOTDIR" ||
        error.code === "EISDIR" ||
        error.code === "EINVAL" ||
        error.code === "ERR_INVALID_ARG_VALUE")
    ) {
      sendNotFound(response);
      return;
    }
    throw error;
  }
}
