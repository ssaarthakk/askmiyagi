import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import { createRepo } from "../../../test/git-helpers.ts";
import type { DiffRequest } from "../../shared/diff-base.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Step } from "../../shared/tour.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

const question = "Explain my diff (uncommitted changes)";

function run(root: string, diff: DiffRequest | undefined, seen: LLMRequest[]) {
  return collect(
    askEvents({
      root,
      provider: scripted([{ type: "done", usage }], seen),
      conversation: createConversation(),
      question,
      diff,
      ack: "One moment.",
      signal: new AbortController().signal,
    }),
  );
}

const oldLimitStep: Step = {
  title: "The old limit",
  anchors: [{ file: "src/upload.ts", line: 1, text: "export const limit = 1", side: "old" }],
  narration: [{ text: "It used to be one." }],
};

async function changedRepo() {
  const root = await createRepo();
  await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");
  return root;
}

describe("askEvents with a diff", () => {
  it("sends the model the diff, the learner's why and the diff rules", async () => {
    const root = await changedRepo();
    const seen: LLMRequest[] = [];

    await run(root, { base: "uncommitted", why: "Uploads need a bigger cap" }, seen);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.question).toContain(question);
    expect(seen[0]?.question).toContain("+export const limit = 2");
    expect(seen[0]?.question).toContain("Uploads need a bigger cap");
    expect(seen[0]?.system).toMatch(/problem[\s\S]*intent[\s\S]*how/i);
    expect(seen[0]?.system).toMatch(/NDJSON/);
  });

  it("leaves the diff rules and the diff out of an ordinary question", async () => {
    const root = await changedRepo();
    const seen: LLMRequest[] = [];

    await run(root, undefined, seen);

    expect(seen[0]?.question).toBe(question);
    expect(seen[0]?.system).not.toMatch(/problem[\s\S]*intent[\s\S]*how/i);
  });

  it("ends with an error and never calls the model when there is nothing to explain", async () => {
    const root = await createRepo();
    const seen: LLMRequest[] = [];

    const events = await run(root, { base: "uncommitted" }, seen);

    expect(events).toEqual([
      { type: "ack", text: "One moment." },
      { type: "error", message: "There are no changes to explain." },
    ]);
    expect(seen).toEqual([]);
  });

  it("resolves an old-side anchor against the diff base and keeps its side", async () => {
    const root = await changedRepo();
    const provider = scripted([
      { type: "step", step: oldLimitStep },
      { type: "done", usage },
    ]);

    const events = await collect(
      askEvents({
        root,
        provider,
        conversation: createConversation(),
        question,
        diff: { base: "uncommitted" },
        ack: "One moment.",
        signal: new AbortController().signal,
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "step",
        ranges: [{ file: "src/upload.ts", start: 1, end: 1, capped: false, side: "old" }],
      }),
    );
  });

  it("shows the old code to a side question about an old-side step", async () => {
    const root = await changedRepo();
    const conversation = createConversation();
    const seen: LLMRequest[] = [];
    const ask = (events: ProviderEvent[], extra: Partial<Parameters<typeof askEvents>[0]>) =>
      collect(
        askEvents({
          root,
          provider: scripted(events, seen),
          conversation,
          question,
          ack: "One moment.",
          signal: new AbortController().signal,
          ...extra,
        }),
      );
    await ask(
      [
        { type: "step", step: oldLimitStep },
        { type: "done", usage },
      ],
      {
        diff: { base: "uncommitted" },
      },
    );

    await ask([{ type: "done", usage }], {
      question: "Why was that removed?",
      current: { tour: question, step: 0, segmentIndex: 0 },
    });

    expect(seen[1]?.question).toMatch(
      /<untrusted_content tool="highlighted_code">1: export const limit = 1<\/untrusted_content>/,
    );
  });

  it("does not keep the diff in the conversation for the next question", async () => {
    const root = await changedRepo();
    const conversation = createConversation();
    const provider = scripted([
      {
        type: "step",
        step: {
          title: "The limit",
          anchors: [{ file: "src/upload.ts", line: 1, text: "export const limit = 2" }],
          narration: [{ text: "The limit goes up." }],
        },
      },
      { type: "done", usage },
    ]);

    await collect(
      askEvents({
        root,
        provider,
        conversation,
        question,
        diff: { base: "uncommitted" },
        ack: "One moment.",
        signal: new AbortController().signal,
      }),
    );

    expect(conversation.render()).toContain(question);
    expect(conversation.render()).not.toContain("+export const limit = 2");
  });
});
