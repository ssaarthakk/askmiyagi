#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createAskHandler } from "./http/ask-route.ts";
import { createFileHandler } from "./http/file-route.ts";
import { serveRequest } from "./http/serve.ts";
import { createSpeechHandler } from "./http/speech-route.ts";
import { claudeHeadless } from "./llm/claude-headless.ts";
import { loadFakeProvider } from "./llm/fake-provider.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { runMcpCommand } from "./mcp/server.ts";
import { openLocalFolder } from "./source/local-folder.ts";

const defaultVoiceId = "JBFqnCBsd6RMkjVDRZzb";

const cliArgsSchema = z.object({
  positionals: z.array(z.string()).max(1, "Only one project path can be provided"),
  port: z
    .string()
    .regex(/^\d+$/, "Port must be an integer between 0 and 65535")
    .transform(Number)
    .pipe(z.number().int().min(0).max(65535))
    .optional(),
  noOpen: z.boolean(),
  provider: z
    .enum(["fake"], { error: (issue) => `Unknown provider: ${String(issue.input)}` })
    .optional(),
  recording: z.string().min(1).optional(),
  voice: z
    .enum(["browser", "elevenlabs"], { error: (issue) => `Unknown voice: ${String(issue.input)}` })
    .optional(),
  voiceId: z.string().min(1, "--voice-id must not be empty").optional(),
  bruteForceTokens: z
    .string()
    .regex(/^[1-9]\d*$/, "--brute-force-tokens must be a positive integer")
    .transform(Number)
    .optional(),
});

export function parseCliArgs(args: string[]) {
  const parsed = parseArgs({
    args,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean" },
      provider: { type: "string" },
      recording: { type: "string" },
      voice: { type: "string" },
      "voice-id": { type: "string" },
      "brute-force-tokens": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const validated = cliArgsSchema.safeParse({
    positionals: parsed.positionals,
    port: parsed.values.port,
    noOpen: parsed.values["no-open"] ?? false,
    provider: parsed.values.provider,
    recording: parsed.values.recording,
    voice: parsed.values.voice,
    voiceId: parsed.values["voice-id"],
    bruteForceTokens: parsed.values["brute-force-tokens"],
  });
  if (!validated.success) {
    throw new Error(validated.error.issues.map((issue) => issue.message).join("\n"));
  }
  const { provider, recording } = validated.data;
  if (provider === "fake" && !recording) {
    throw new Error("--provider fake needs --recording <file>");
  }
  if (recording && provider !== "fake") {
    throw new Error("--recording only works with --provider fake");
  }
  return {
    path: validated.data.positionals[0] ?? ".",
    port: validated.data.port ?? 0,
    noOpen: validated.data.noOpen,
    provider,
    recording,
    voice: validated.data.voice ?? "browser",
    voiceId: validated.data.voiceId ?? defaultVoiceId,
    bruteForceTokens: validated.data.bruteForceTokens,
  };
}

export function speechOptions(options: ReturnType<typeof parseCliArgs>, env: NodeJS.ProcessEnv) {
  return {
    apiKey: options.voice === "elevenlabs" ? env.ELEVENLABS_API_KEY : undefined,
    voiceId: options.voiceId,
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

  const source = await openLocalFolder(options.path);
  if (!source.ok) {
    process.stderr.write(`${source.error}\n`);
    process.exitCode = 1;
    return;
  }

  let provider: LLMProvider = claudeHeadless;
  if (options.provider === "fake" && options.recording) {
    const fake = await loadFakeProvider(resolve(options.recording));
    if (!fake.ok) {
      process.stderr.write(`${fake.error}
`);
      await source.value.dispose();
      process.exitCode = 1;
      return;
    }
    provider = fake.value;
  }
  const handleAsk = createAskHandler({
    root: source.value.root,
    provider,
    bruteForceTokens: options.bruteForceTokens,
  });

  const handleFile = createFileHandler(source.value.root);
  const handleSpeech = createSpeechHandler(speechOptions(options, process.env));

  const webRoot = resolve(import.meta.dirname, "../../dist/web");
  let page: string;
  const sessionToken = randomBytes(32).toString("hex");
  try {
    const template = await readFile(resolve(webRoot, "index.html"), "utf8");
    page = template.replace(
      "</head>",
      `<meta name="miyagi-token" content="${sessionToken}"><meta name="miyagi-voice" content="${options.voice}"></head>`,
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
      handleAsk,
      handleFile,
      handleSpeech,
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
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdout.write(`${url}\n`);
  if (!options.noOpen) openBrowser(url);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCli();
}
