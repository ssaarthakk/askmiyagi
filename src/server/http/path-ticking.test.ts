import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal, usage } from "../../../test/ask-helpers.ts";
import { listen, pathProject, writePathProject } from "../../../test/path-project.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { defaultProfile } from "../../shared/profile.ts";
import type { Step } from "../../shared/tour.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { writeProfile } from "../teach/profile.ts";
import { createAskHandler } from "./ask-route.ts";
import { createPathHandler } from "./path-route.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const pathConcepts = ["Startup", "Serving", "Storage", "Clips", "Leftovers"];

const storeStep: Step = {
  title: "Storage",
  anchors: [{ file: "src/store.ts", line: 1, text: "export const read = 1;" }],
  narration: [{ text: "Data is read here." }],
};

function planning(): ProviderEvent[] {
  const items = pathConcepts.map((concept, index) => ({
    concept,
    question: `How does ${concept} work?`,
    file: Object.keys(pathProject)[index],
  }));
  return [
    { type: "text", text: JSON.stringify({ items }) },
    { type: "done", usage },
  ];
}

function tutoring(reported: ProviderEvent[], seen: LLMRequest[]): LLMProvider {
  return {
    async *ask(request) {
      if (!request.tools) {
        yield* planning();
        return;
      }
      seen.push(request);
      yield { type: "step", step: storeStep };
      yield* reported;
      yield { type: "done", usage };
    },
  };
}

async function start(reported: ProviderEvent[] = [], seen: LLMRequest[] = []) {
  terminal();
  const root = await writePathProject();
  const tutorRoot = await tempDir();
  await writeProfile(tutorRoot, { ...defaultProfile, goal: "Add retries" });
  const provider = tutoring(reported, seen);
  const ask = createAskHandler({ root, provider, providerName: "fake", tutorRoot });
  const handlePath = createPathHandler({
    root,
    tutorRoot,
    provider,
    providerName: "fake",
    learner: ask.learner,
  });
  const routes: Record<string, typeof ask.handle> = {
    "/api/ask": ask.handle,
    "/api/played": ask.played,
    "/api/path": handlePath,
  };
  const origin = await listen(
    (request, response) => void routes[request.url ?? ""]?.(request, response),
  );
  const post = (path: string, body: object) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const ticks = async () => {
    const path = (await (await fetch(`${origin}/api/path`)).json()) as {
      items: { concept: string; done: boolean }[];
    };
    return path.items.filter((item) => item.done).map((item) => item.concept);
  };
  return { post, ticks };
}

async function playTour(post: Awaited<ReturnType<typeof start>>["post"], body: object) {
  const question = "How does Storage work?";
  await (await post("/api/ask", { question, ...body })).text();
  await post("/api/played", { tour: question });
}

describe("ticking a path item", () => {
  it("ticks the item asked from the path when its tour is played, even if the tour names other concepts", async () => {
    const seen: LLMRequest[] = [];
    const reported: ProviderEvent[] = [
      { type: "concepts", concepts: [{ name: "Reading data", important: true, kind: "repo" }] },
    ];
    const { post, ticks } = await start(reported, seen);
    await post("/api/path", {});

    await playTour(post, { pathConcept: "Storage" });

    expect(await ticks()).toEqual(["Storage"]);
    expect(seen[0]?.question).toContain(
      '<untrusted_content tool="path_concept">Storage</untrusted_content>',
    );
  });

  it("ticks the item when the tour reports no concepts at all", async () => {
    const { post, ticks } = await start();
    await post("/api/path", {});

    await playTour(post, { pathConcept: "storage" });

    expect(await ticks()).toEqual(["Storage"]);
  });

  it("ticks nothing for a tour that was not asked from the path", async () => {
    const { post, ticks } = await start();
    await post("/api/path", {});

    await playTour(post, {});

    expect(await ticks()).toEqual([]);
  });

  it("refuses an empty or over-long path concept", async () => {
    const { post } = await start();

    const empty = await post("/api/ask", { question: "How?", pathConcept: " " });
    const long = await post("/api/ask", { question: "How?", pathConcept: "x".repeat(101) });

    expect(empty.status).toBe(400);
    expect(long.status).toBe(400);
  });
});
