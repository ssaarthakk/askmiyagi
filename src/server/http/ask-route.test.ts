import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LLMProvider } from "../llm/provider.ts";
import { createAskHandler } from "./ask-route.ts";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

const provider: LLMProvider = {
  async *ask() {
    yield { type: "done", usage };
  },
};

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function askOnce() {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-ask-route-"));
  cleanups.push(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "project");
  await cp("test/fixtures/basic", root, { recursive: true });
  const handleAsk = createAskHandler({ root, provider, providerName: "fake", logCalls: false });
  const server = createServer((request, response) => void handleAsk(request, response));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise((done) => server.close(done)));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How are clips saved?" }),
  });
  await response.text();
  return readdir(root);
}

describe("createAskHandler call log", () => {
  it("writes no call log when logCalls is false, as for a cloned URL source", async () => {
    expect(await askOnce()).not.toContain(".tutor");
  });
});
