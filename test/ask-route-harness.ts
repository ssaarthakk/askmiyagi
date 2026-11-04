import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAskHandler } from "../src/server/http/ask-route.ts";
import type { LLMProvider } from "../src/server/llm/provider.ts";
import { writeProfile } from "../src/server/teach/profile.ts";
import type { LLMRequest } from "../src/shared/llm-request.ts";
import { saveStep, usage } from "./ask-helpers.ts";

export const requests: LLMRequest[] = [];

const provider: LLMProvider = {
  async *ask(request) {
    requests.push(request);
    yield { type: "step", step: saveStep };
    yield { type: "done", usage };
  },
};

const cleanups: (() => Promise<unknown>)[] = [];

export async function cleanAskRoute() {
  requests.length = 0;
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
}

export async function saveFrequentProfile(tutorRoot: string) {
  const saved = await writeProfile(tutorRoot, {
    level: "intermediate",
    mode: "teach",
    frequency: "frequent",
    goal: null,
  });
  if (!saved.ok) throw new Error(saved.error);
}

export async function startAsk(separateTutorRoot = false, chosen = provider) {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-ask-route-"));
  cleanups.push(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "project");
  await cp("test/fixtures/basic", root, { recursive: true });
  const tutorRoot = separateTutorRoot ? join(parent, "store") : root;
  if (separateTutorRoot) await mkdir(tutorRoot);
  const ask = createAskHandler({ root, provider: chosen, providerName: "fake", tutorRoot });
  const handlers: Record<string, typeof ask.handle> = {
    "/api/played": ask.played,
    "/api/skipped": ask.skipped,
    "/api/predict": ask.predict,
  };
  const server = createServer(
    (request, response) => void (handlers[request.url ?? ""] ?? ask.handle)(request, response),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise((done) => server.close(done)));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const post = (body: object, path = "/api/ask") =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { root, tutorRoot, post };
}
