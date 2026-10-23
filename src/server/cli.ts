#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { openLocalFolder } from "./source/local-folder.ts";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

function sendNotFound(response: import("node:http").ServerResponse) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function sendSecurityError(
  response: import("node:http").ServerResponse,
  status: number,
  reason: string,
) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: reason }));
}

async function serveRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  webRoot: string,
  page: string,
  token: string,
  port: number,
) {
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(request.headers.host?.toLowerCase() ?? "")) {
    sendSecurityError(response, 403, "Forbidden host");
    return;
  }
  const origin = request.headers.origin;
  if (origin && !allowedHosts.some((host) => `http://${host}` === origin)) {
    sendSecurityError(response, 403, "Forbidden origin");
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
    sendSecurityError(response, 401, "Unauthorized");
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

const cliArgsSchema = z.object({
  positionals: z.array(z.string()).max(1, "Only one project path can be provided"),
  port: z
    .string()
    .regex(/^\d+$/, "Port must be an integer between 0 and 65535")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535))
    .optional(),
  noOpen: z.boolean(),
});

export function parseCliArgs(args: string[]) {
  const parsed = parseArgs({
    args,
    options: { port: { type: "string" }, "no-open": { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  const validated = cliArgsSchema.safeParse({
    positionals: parsed.positionals,
    port: parsed.values.port,
    noOpen: parsed.values["no-open"] ?? false,
  });
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("\n"));
  }
  return {
    path: validated.data.positionals[0] ?? ".",
    port: validated.data.port ?? 0,
    noOpen: validated.data.noOpen,
  };
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const browser = spawn(command, args, { shell: false, detached: true, stdio: "ignore" });
    let failed = false;
    const reportFailure = () => {
      if (failed) return;
      failed = true;
      process.stderr.write(`Open ${url} in your browser\n`);
    };
    browser.once("error", reportFailure);
    browser.once("exit", (code) => {
      if (code !== 0) reportFailure();
    });
    browser.unref();
  } catch {
    process.stderr.write(`Open ${url} in your browser\n`);
  }
}

async function runCli() {
  let options: ReturnType<typeof parseCliArgs>;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const source = await openLocalFolder(options.path);
  if (!source.ok) {
    process.stderr.write(`${source.error}\n`);
    process.exitCode = 1;
    return;
  }

  const webRoot = resolve(import.meta.dirname, "../../dist/web");
  let page: string;
  const sessionToken = randomBytes(32).toString("hex");
  try {
    const template = await readFile(resolve(webRoot, "index.html"), "utf8");
    page = template.replace(
      "</head>",
      `<meta name="miyagi-token" content="${sessionToken}"></head>`,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      process.stderr.write("Run npm run build first\n");
    } else {
      process.stderr.write(
        `Could not read built page: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    await source.value.dispose();
    process.exitCode = 1;
    return;
  }

  let serverPort: number;
  const server = createServer((request, response) => {
    void serveRequest(request, response, webRoot, page, sessionToken, serverPort).catch(
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      },
    );
  });

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(options.port, "127.0.0.1", resolveListen);
    });
  } catch (error) {
    process.stderr.write(
      `Could not start server: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    await source.value.dispose();
    process.exitCode = 1;
    return;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    process.stderr.write("Could not determine server address\n");
    await source.value.dispose();
    server.close();
    process.exitCode = 1;
    return;
  }
  serverPort = address.port;

  const url = `http://127.0.0.1:${address.port}/`;
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void source.value.dispose().then(
        () => {
          process.exitCode = 0;
        },
        (error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode = 1;
        },
      );
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdout.write(`${url}\n`);
  if (!options.noOpen) openBrowser(url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCli();
}
