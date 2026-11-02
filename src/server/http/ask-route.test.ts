import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveStep } from "../../../test/ask-helpers.ts";
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
    yield { type: "step", step: saveStep };
    yield { type: "done", usage };
  },
};

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startAsk(writeTutorFiles: boolean) {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-ask-route-"));
  cleanups.push(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "project");
  await cp("test/fixtures/basic", root, { recursive: true });
  const ask = createAskHandler({ root, provider, providerName: "fake", writeTutorFiles });
  const server = createServer((request, response) => void ask.handle(request, response));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise((done) => server.close(done)));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const post = (body: object) =>
    fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { root, post };
}

async function askOnce(writeTutorFiles: boolean) {
  const { root, post } = await startAsk(writeTutorFiles);
  await (await post({ question: "How are clips saved?" })).text();
  return root;
}

describe("createAskHandler tutor files", () => {
  it("writes the call log and the session record under .tutor/private for a local folder", async () => {
    const root = await askOnce(true);
    expect((await readdir(join(root, ".tutor", "private"))).toSorted()).toEqual([
      "calls.jsonl",
      "session.json",
    ]);
    const session = JSON.parse(
      await readFile(join(root, ".tutor", "private", "session.json"), "utf8"),
    );
    expect(session.turns).toEqual([
      { question: "How are clips saved?", record: expect.stringContaining("Saving a clip") },
    ]);
  });

  it("writes no .tutor files when writeTutorFiles is false, as for a cloned URL source", async () => {
    expect(await readdir(await askOnce(false))).not.toContain(".tutor");
  });
});

describe("createAskHandler current position", () => {
  it("accepts a current position and refuses a malformed one", async () => {
    const { post } = await startAsk(false);
    const question = "What does that return?";

    const accepted = await post({ question, current: { tour: "t", step: 0, segmentIndex: 2 } });
    await accepted.text();
    const negative = await post({ question, current: { tour: "t", step: -1, segmentIndex: 0 } });
    const missing = await post({ question, current: { step: 0, segmentIndex: 0 } });
    const tooLong = await post({
      question,
      current: { tour: "x".repeat(2001), step: 0, segmentIndex: 0 },
    });

    expect(accepted.status).toBe(200);
    expect(negative.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });
});
