import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal, usage } from "../../../test/ask-helpers.ts";
import { loggedCallTypes } from "../../../test/ask-route-harness.ts";
import { listen, writePathProject } from "../../../test/path-project.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import type { PathItem } from "../../shared/path.ts";
import { defaultProfile } from "../../shared/profile.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { createLearnerRecord } from "../teach/learner.ts";
import { writeProfile } from "../teach/profile.ts";
import { createPathHandler } from "./path-route.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function item(concept: string, file: string): PathItem {
  return { concept, question: `How does ${concept} work?`, file };
}

const planned = [
  item("Startup", "src/main.ts"),
  item("Serving", "src/server.ts"),
  item("Storage", "src/store.ts"),
  item("Clips", "src/clip.ts"),
  item("Leftovers", "src/orphan.ts"),
];
const orderedConcepts = ["Storage", "Serving", "Leftovers", "Clips", "Startup"];

type Listed = { items: { concept: string; done: boolean }[] };

function replying(items: PathItem[], seen: string[] = []): LLMProvider {
  return {
    async *ask(request) {
      seen.push(request.question);
      yield { type: "text", text: JSON.stringify({ items }) };
      yield { type: "done", usage };
    },
  };
}

async function start(
  provider: LLMProvider = replying(planned),
  goal: string | null = "Add retries",
) {
  const root = await writePathProject();
  const tutorRoot = await tempDir();
  if (goal !== null) await writeProfile(tutorRoot, { ...defaultProfile, goal });
  const learner = createLearnerRecord(tutorRoot);
  const handler = createPathHandler({ root, tutorRoot, provider, providerName: "fake", learner });
  const url = `${await listen((request, response) => void handler(request, response))}/api/path`;
  return {
    tutorRoot,
    learner,
    privateFolder: join(tutorRoot, ".tutor", "private"),
    get: () => fetch(url),
    plan: () =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
  };
}

async function listed(response: Response) {
  return (await response.json()) as Listed;
}

async function concepts(response: Response) {
  return (await listed(response)).items.map((entry) => entry.concept);
}

describe("createPathHandler", () => {
  it("answers null until a path is planned", async () => {
    const { get } = await start();

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("plans a path from the goal, orders it by imports, saves it and answers it", async () => {
    const seen: string[] = [];
    const { plan, get, privateFolder } = await start(replying(planned, seen));

    const response = await plan();

    expect(response.status).toBe(200);
    expect(await concepts(response)).toEqual(orderedConcepts);
    expect(seen[0]).toContain("Add retries");
    expect(seen[0]).toContain("src/store.ts");
    const saved = JSON.parse(await readFile(join(privateFolder, "path.json"), "utf8"));
    expect(saved.items.map((entry: PathItem) => entry.concept)).toEqual(orderedConcepts);
    expect(saved.items[0]).toEqual(item("Storage", "src/store.ts"));
    expect(await concepts(await get())).toEqual(orderedConcepts);
  });

  it("logs the planning call as a path call", async () => {
    const { plan, tutorRoot } = await start();

    await plan();

    expect(await loggedCallTypes(tutorRoot)).toEqual(["path"]);
  });

  it("asks for a goal first when the profile has none, and does not call the model", async () => {
    terminal();
    const seen: string[] = [];
    const none = await start(replying(planned, seen), null);
    const empty = await start(replying(planned, seen), null);
    await writeProfile(empty.tutorRoot, defaultProfile);

    const first = await none.plan();
    const second = await empty.plan();

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(await first.json()).toEqual({ error: expect.stringMatching(/goal/i) });
    expect(seen).toEqual([]);
    expect(await (await none.get()).json()).toBeNull();
  });

  it("marks an item done once its concept is explained, ignoring case, and not when it is only seen", async () => {
    const { plan, get, learner } = await start();
    await plan();

    await learner.markSeen([{ name: "Storage", important: true, kind: "repo" }]);
    const seenOnly = await listed(await get());
    await learner.markExplained([{ name: "serving", important: true, kind: "repo" }]);
    const explained = await listed(await get());

    expect(seenOnly.items.some((entry) => entry.done)).toBe(false);
    expect(explained.items.map((entry) => [entry.concept, entry.done])).toEqual([
      ["Storage", false],
      ["Serving", true],
      ["Leftovers", false],
      ["Clips", false],
      ["Startup", false],
    ]);
  });

  it("replaces the path when a new one is planned, with nothing ticked unless it was explained", async () => {
    const second = [
      item("Reading", "src/store.ts"),
      item("Serving again", "src/server.ts"),
      item("Entry", "src/main.ts"),
      item("Clips again", "src/clip.ts"),
      item("Orphans", "src/orphan.ts"),
    ];
    const providers = [replying(planned), replying(second)];
    const provider: LLMProvider = {
      async *ask(request, signal) {
        const chosen = providers.shift();
        if (chosen) yield* chosen.ask(request, signal);
      },
    };
    const { plan, get, learner } = await start(provider);
    await plan();
    await learner.markExplained([{ name: "Reading", important: true, kind: "repo" }]);

    await plan();

    const after = await listed(await get());
    expect(after.items.map((entry) => entry.concept)).toEqual([
      "Reading",
      "Serving again",
      "Orphans",
      "Clips again",
      "Entry",
    ]);
    expect(after.items.map((entry) => entry.done)).toEqual([true, false, false, false, false]);
  });

  it("drops items about files that do not exist, and refuses the path when fewer than 5 are left", async () => {
    terminal();
    const ghost = item("Ghost", "src/missing.ts");
    const outside = item("Outside", "../outside.ts");
    const withExtras = await start(replying([...planned, ghost, outside]));
    const tooFew = await start(replying([...planned.slice(0, 4), ghost]));

    const accepted = await withExtras.plan();
    const refused = await tooFew.plan();

    expect(await concepts(accepted)).toEqual(orderedConcepts);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: expect.any(String) });
    expect(await (await tooFew.get()).json()).toBeNull();
  });

  it("keeps the old path when the model fails", async () => {
    terminal();
    let failing = false;
    const provider: LLMProvider = {
      async *ask(request, signal) {
        if (failing) yield { type: "error", message: "Rate limited", retryable: true };
        else yield* replying(planned).ask(request, signal);
      },
    };
    const { plan, get } = await start(provider);
    await plan();
    failing = true;

    const response = await plan();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Rate limited" });
    expect(await concepts(await get())).toEqual(orderedConcepts);
  });

  it("treats a corrupt path file as no path, moves it aside and plans a new one", async () => {
    const written = terminal();
    const { plan, get, privateFolder } = await start();
    await plan();
    await writeFile(join(privateFolder, "path.json"), '{"items": [{"concept": 3}]}');

    const corrupt = await get();
    const replanned = await plan();

    expect(await corrupt.json()).toBeNull();
    expect(await readdir(privateFolder)).toContain("path.json.corrupt");
    expect(written()).toMatch(/path\.json is not valid/);
    expect(await concepts(replanned)).toEqual(orderedConcepts);
    expect(await concepts(await get())).toEqual(orderedConcepts);
  });
});
