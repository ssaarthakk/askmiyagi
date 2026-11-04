#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseCliArgs, speechOptions } from "./cli-args.ts";
import { scopeToApp } from "./files/file-filter.ts";
import { watchFolder } from "./files/watcher.ts";
import { createAskHandler } from "./http/ask-route.ts";
import { createEventsHandler } from "./http/events-route.ts";
import { createFileHandler } from "./http/file-route.ts";
import { createFirstSoundHandler } from "./http/first-sound-route.ts";
import { createProfileHandler } from "./http/profile-route.ts";
import { serveRequest } from "./http/serve.ts";
import { createSpeechHandler } from "./http/speech-route.ts";
import { createSymbolsHandler } from "./http/symbols-route.ts";
import { createTranscribeHandler } from "./http/transcribe-route.ts";
import { chooseProvider } from "./llm/choose-provider.ts";
import { logError } from "./log.ts";
import { runMcpCommand } from "./mcp/server.ts";
import { runSnapshotCommand } from "./snapshot-command.ts";
import { openGitClone } from "./source/git-clone.ts";
import { type CodeSource, openLocalFolder } from "./source/local-folder.ts";
import { chooseApp, findApps } from "./source/monorepo.ts";
import { projectName } from "./source/project-name.ts";
import { createTourWatch } from "./tour-watch.ts";

export function closeServer(server: Server, source: CodeSource) {
  return new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
    server.closeAllConnections();
  }).then(() => source.dispose());
}

function askOnTerminal(interrupted: AbortController) {
  return async (question: string) => {
    const lines = createInterface({ input: process.stdin, output: process.stderr });
    lines.once("SIGINT", () => interrupted.abort());
    try {
      return await lines.question(question, { signal: interrupted.signal });
    } catch {
      return "";
    } finally {
      lines.close();
    }
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
  const [subcommand, ...subcommandArgs] = process.argv.slice(2);
  if (subcommand === "mcp") {
    await runMcpCommand(subcommandArgs);
    return;
  }

  if (subcommand === "snapshot") {
    await runSnapshotCommand(subcommandArgs);
    return;
  }

  let options: ReturnType<typeof parseCliArgs>;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.voice === "elevenlabs" && !process.env.ELEVENLABS_API_KEY) {
    process.stderr.write("Set ELEVENLABS_API_KEY to use --voice elevenlabs\n");
    process.exitCode = 1;
    return;
  }

  const provider = await chooseProvider(options);
  if (!provider.ok) {
    process.stderr.write(`${provider.error}\n`);
    process.exitCode = 1;
    return;
  }

  const interrupted = new AbortController();
  process.on("SIGINT", () => interrupted.abort());
  process.on("SIGTERM", () => interrupted.abort());

  const source = options.isUrl
    ? await openGitClone(options.path, interrupted.signal)
    : await openLocalFolder(options.path);
  if (!source.ok) {
    process.stderr.write(`${source.error}\n`);
    process.exitCode = 1;
    return;
  }

  const app = await chooseApp({
    apps: await findApps(source.value.root),
    requested: options.app,
    ask: process.stdin.isTTY ? askOnTerminal(interrupted) : undefined,
  });
  if (!app.ok) {
    await source.value.dispose();
    if (interrupted.signal.aborted) return;
    process.stderr.write(`${app.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (app.value) scopeToApp(source.value.root, app.value);

  const tutorRoot = source.value.tutorRoot ?? source.value.root;
  const events = createEventsHandler();
  const tourWatch = createTourWatch({ root: source.value.root, publish: events.publish });
  const ask = createAskHandler({
    root: source.value.root,
    provider: provider.value,
    providerName: options.provider,
    tutorRoot,
    bruteForceTokens: options.bruteForceTokens,
    contextTokens: options.contextTokens,
    tourWatch,
  });

  const handleFile = createFileHandler(source.value.root);
  const handleSymbols = createSymbolsHandler(source.value.root);
  const handleFirstSound = createFirstSoundHandler(tutorRoot);
  const handleProfile = createProfileHandler(tutorRoot);
  const speech = speechOptions(options, process.env);
  const handleSpeech = createSpeechHandler(speech);
  const handleTranscribe = createTranscribeHandler({ apiKey: speech.apiKey });

  const webRoot = resolve(import.meta.dirname, "../../dist/web");
  let page: string;
  const sessionToken = randomBytes(32).toString("hex");
  try {
    const template = await readFile(resolve(webRoot, "index.html"), "utf8");
    page = template.replace(
      "</head>",
      `<meta name="miyagi-token" content="${sessionToken}"><meta name="miyagi-voice" content="${options.voice}"><meta name="miyagi-project" content="${encodeURIComponent(projectName(options.path, source.value.root))}"></head>`,
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
    void serveRequest(
      request,
      response,
      webRoot,
      page,
      sessionToken,
      serverPort,
      ask,
      handleFile,
      handleSpeech,
      handleTranscribe,
      events,
      handleSymbols,
      handleFirstSound,
      handleProfile,
    ).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
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

  const watcher = watchFolder(source.value.root, (paths) => {
    tourWatch.changed(paths).catch((error: unknown) => {
      logError(
        `Could not check the tour after a code change: ${error instanceof Error ? error.message : error}`,
      );
    });
  });
  const url = `http://127.0.0.1:${address.port}/`;
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    watcher.close();
    void closeServer(server, source.value).then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      },
    );
  };
  interrupted.signal.addEventListener("abort", shutdown, { once: true });
  if (interrupted.signal.aborted) shutdown();
  process.stdout.write(`${url}\n`);
  if (!options.noOpen) openBrowser(url);
}

function startedAsCli() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1] ?? "")).href;
  } catch {
    return false;
  }
}

if (startedAsCli()) {
  void runCli();
}
