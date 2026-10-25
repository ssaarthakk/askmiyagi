import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach } from "vitest";
import type { LLMRequest } from "../src/shared/llm-request.ts";

export const request: LLMRequest = {
  system: "You are Miyagi.",
  context: "=== a.ts ===\n1: export const a = 1;",
  conversation: "",
  question: "What is a?",
  root: "/some/repo",
  tools: true,
  model: "strong",
};

const fakeScript = `
const { spawn } = require("node:child_process");
const { readdirSync, writeFileSync, readFileSync } = require("node:fs");
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { stdin += chunk; });
process.stdin.on("end", () => {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--mcp-config");
  writeFileSync(process.env.FAKE_RECORD, JSON.stringify({
    args,
    stdin,
    cwd: process.cwd(),
    cwdEntries: readdirSync(process.cwd()),
    mcpConfig: configIndex === -1 ? null : JSON.parse(readFileSync(args[configIndex + 1], "utf8")),
    envKeys: Object.keys(process.env),
    disableTraffic: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
  }));
  const mode = process.env.FAKE_MODE;
  if (mode === "ok") {
    console.log('{"type":"system"}');
    console.log("");
    console.log('{"type":"result"}');
  } else if (mode === "logged-out") {
    console.log('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Not logged in \u00b7 Please run /login"}]},"error":"authentication_failed"}');
    console.log('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in \u00b7 Please run /login","usage":{}}');
    process.exit(1);
  } else if (mode === "fail") {
    console.error("boom happened");
    process.exit(3);
  } else if (mode === "hang") {
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    writeFileSync(process.env.FAKE_PIDS, grandchild.pid + "," + process.pid);
    console.log('{"type":"system"}');
    setInterval(() => {}, 1000);
  }
});
`;

const dirs: string[] = [];

export async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "miyagi-claude-test-"));
  dirs.push(dir);
  return dir;
}

async function installFakeClaude() {
  const dir = await tempDir();
  const script = join(dir, "fake-claude.cjs");
  await writeFile(script, fakeScript);
  if (process.platform === "win32") {
    await writeFile(join(dir, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const shim = join(dir, "claude");
    await writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    await chmod(shim, 0o755);
  }
  return dir;
}

export async function fakeEnv(mode: string, extra: Record<string, string> = {}) {
  const fakeDir = await installFakeClaude();
  const work = await tempDir();
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name.toUpperCase() !== "PATH") env[name] = value;
  }
  Object.assign(env, {
    PATH: fakeDir,
    FAKE_MODE: mode,
    FAKE_RECORD: join(work, "record.json"),
    FAKE_PIDS: join(work, "pids.txt"),
    ...extra,
  });
  return { env, work };
}

export async function recorded(work: string) {
  return JSON.parse(await readFile(join(work, "record.json"), "utf8"));
}

export async function collect<T>(stream: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`${path} never appeared`);
}

export async function waitUntilDead(pid: number) {
  for (let attempt = 0; attempt < 100 && isAlive(pid); attempt++) await sleep(50);
  return !isAlive(pid);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
