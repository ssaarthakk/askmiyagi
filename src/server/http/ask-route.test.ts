import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveStep, usage } from "../../../test/ask-helpers.ts";
import { cleanAskRoute, requests, startAsk } from "../../../test/ask-route-harness.ts";
import { learnerSchema } from "../../shared/learner.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { writeProfile } from "../teach/profile.ts";

afterEach(cleanAskRoute);

async function askOnce(separateTutorRoot: boolean) {
  const started = await startAsk(separateTutorRoot);
  await (await started.post({ question: "How are clips saved?" })).text();
  return started;
}

describe("createAskHandler tutor files", () => {
  it("writes the call log and the session record under .tutor/private for a local folder", async () => {
    const { root } = await askOnce(false);
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

  it("writes them in the tutor root, not the project, when the source keeps its store elsewhere", async () => {
    const { root, tutorRoot } = await askOnce(true);

    expect((await readdir(join(tutorRoot, ".tutor", "private"))).toSorted()).toEqual([
      "calls.jsonl",
      "session.json",
    ]);
    expect(await readdir(root)).not.toContain(".tutor");
  });
});

describe("createAskHandler profile", () => {
  it("gives every ask's prompt the level and the goal saved in the tutor root", async () => {
    const { tutorRoot, post } = await startAsk(true);
    const saved = await writeProfile(tutorRoot, {
      level: "advanced",
      mode: "teach",
      frequency: "normal",
      goal: "Add a retry to uploads",
    });
    if (!saved.ok) throw new Error(saved.error);

    await (await post({ question: "How are clips saved?" })).text();

    const prompt = requests.at(-1)?.question ?? "";
    expect(prompt).toContain("advanced");
    expect(prompt).toContain(
      '<untrusted_content tool="goal">Add a retry to uploads</untrusted_content>',
    );
  });

  it("adds nothing when the tutor root has no profile", async () => {
    const { post } = await startAsk(true);

    await (await post({ question: "How are clips saved?" })).text();

    expect(requests.at(-1)?.question).not.toContain("untrusted_content");
  });
});

describe("createAskHandler current position", () => {
  it("accepts a current position and refuses a malformed one", async () => {
    const { post } = await startAsk();
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

describe("createAskHandler intent", () => {
  it("accepts a chosen intent and refuses an unknown one", async () => {
    const { post } = await startAsk();
    const question = "How are clips saved?";

    const accepted = await post({ question, intent: "debugging" });
    await accepted.text();
    const unknown = await post({ question, intent: "curiosity" });

    expect(accepted.status).toBe(200);
    expect(unknown.status).toBe(400);
  });
});

describe("createAskHandler diff", () => {
  it("accepts a diff base with or without a why and refuses a bad one", async () => {
    const { post } = await startAsk();
    const question = "Explain my diff (uncommitted changes)";

    const accepted = await post({ question, diff: { base: "uncommitted", why: "Raise the cap" } });
    const events = await accepted.text();
    const unknownBase = await post({ question, diff: { base: "stash" } });
    const missingBase = await post({ question, diff: { why: "Raise the cap" } });
    const emptyWhy = await post({ question, diff: { base: "branch", why: "   " } });
    const longWhy = await post({ question, diff: { base: "branch", why: "x".repeat(2001) } });

    expect(accepted.status).toBe(200);
    expect(events).toContain('"type":"error"');
    expect(unknownBase.status).toBe(400);
    expect(missingBase.status).toBe(400);
    expect(emptyWhy.status).toBe(400);
    expect(longWhy.status).toBe(400);
  });
});

describe("createAskHandler learner record", () => {
  const conceptProvider: LLMProvider = {
    async *ask() {
      yield { type: "step", step: saveStep };
      yield {
        type: "concepts",
        concepts: [{ name: "Upload retries", important: true, kind: "repo" }],
      };
      yield { type: "done", usage };
    },
  };

  async function recorded(tutorRoot: string) {
    const file = join(tutorRoot, ".tutor", "private", "learner.json");
    return learnerSchema.parse(JSON.parse(await readFile(file, "utf8")));
  }

  it("ignores a played tour it does not know, and refuses a malformed body", async () => {
    const { tutorRoot, post } = await startAsk(true, conceptProvider);
    await (await post({ question: "How are clips saved?" })).text();
    await vi.waitFor(async () =>
      expect((await recorded(tutorRoot)).concepts).toMatchObject([{ state: "seen" }]),
    );

    const unknown = await post({ tour: "Something else" }, "/api/played");
    const missing = await post({}, "/api/played");
    const tooLong = await post({ tour: "x".repeat(2001) }, "/api/played");

    expect(unknown.status).toBe(204);
    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect((await recorded(tutorRoot)).concepts).toMatchObject([{ state: "seen" }]);
  });
});
