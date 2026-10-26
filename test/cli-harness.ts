import { spawn } from "node:child_process";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { afterEach } from "vitest";

export const root = resolve(import.meta.dirname, "..");
export const sourceCli = join(root, "src", "server", "cli.ts");
export const builtCli = join(root, "dist", "server", "cli.js");
export const nonLoopbackIPv4 = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .find((address) => address.family === "IPv4" && !address.internal)?.address;

const children: ReturnType<typeof spawn>[] = [];

export function startCli(cli: string, args: string[], cwd = root, env?: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

export function waitForLine(childProcess: ReturnType<typeof startCli>) {
  return new Promise<string>((resolveLine, reject) => {
    const timeout = setTimeout(() => reject(new Error("CLI did not print its URL")), 5000);
    const check = () => {
      const line = childProcess.stdout.split(/\r?\n/).find(Boolean);
      if (line) {
        clearTimeout(timeout);
        resolveLine(line);
      }
    };
    childProcess.child.stdout.on("data", check);
    childProcess.child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    childProcess.child.once("close", (code) => {
      clearTimeout(timeout);
      reject(new Error(`CLI exited with code ${code}: ${childProcess.stderr.trim()}`));
    });
    check();
  });
}

export async function startServer(folder: string, args: string[] = [], env?: NodeJS.ProcessEnv) {
  const server = startCli(sourceCli, ["--no-open", "--port", "0", ...args, folder], undefined, env);
  const url = await waitForLine(server);
  const page = await (await fetch(url)).text();
  const token = page.match(/<meta name="miyagi-token" content="([a-f0-9]{64})">/)?.[1] ?? "";
  return { server, url, token };
}

export function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

export function requestPath(
  url: string,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) {
  const address = new URL(url);
  return new Promise<{ status: number; body: string }>((resolveResponse, reject) => {
    const outgoing = request(
      { hostname: address.hostname, port: address.port, path, method, headers },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolveResponse({ status: response.statusCode ?? 0, body });
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exit = waitForExit(child);
      child.kill("SIGKILL");
      await exit;
    }),
  );
});
