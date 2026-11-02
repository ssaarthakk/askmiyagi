import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { key } from "../../../test/conversation-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Current } from "../../shared/tour.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";
import type { LLMProvider } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const earlierQuestion = "How are clips saved?";
const current: Current = { tour: earlierQuestion, step: 0, segmentIndex: 0 };

function run(
  events: ProviderEvent[],
  conversation: ReturnType<typeof createConversation>,
  seen: LLMRequest[],
  options: { question?: string; current?: Current } = {},
) {
  return collect(
    askEvents({
      root,
      provider: scripted(events, seen),
      conversation,
      question: options.question ?? "What does that return?",
      current: options.current,
      ack: "One moment.",
      signal: new AbortController().signal,
    }),
  );
}

async function afterTour(step = saveStep) {
  const conversation = createConversation();
  const seen: LLMRequest[] = [];
  await run(
    [
      { type: "step", step },
      { type: "done", usage },
    ],
    conversation,
    seen,
    {
      question: earlierQuestion,
    },
  );
  return { conversation, seen };
}

describe("askEvents side-question context", () => {
  it("tells the model the step, the segment just heard and the highlighted code", async () => {
    const { conversation, seen } = await afterTour();

    await run([{ type: "done", usage }], conversation, seen, { current });

    const question = seen[1]?.question ?? "";
    expect(question).toContain("What does that return?");
    expect(question).toContain("Saving a clip");
    expect(question).toContain("Clips are saved here.");
    expect(question).toContain("save(clip: string)");
    expect(question).toMatch(/<untrusted_content tool="highlighted_code">/);
  });

  it("uses the anchor of the segment the learner is on", async () => {
    const twoAnchors = {
      title: "Two places",
      anchors: [
        { file: "src/clip-service.ts", symbol: "ClipService.save" },
        { file: "src/upload.ts", symbol: "uploadClip" },
      ],
      narration: [
        { text: "First the service.", anchor: 0 },
        { text: "Then the upload.", anchor: 1 },
      ],
    };
    const { conversation, seen } = await afterTour(twoAnchors);

    await run([{ type: "done", usage }], conversation, seen, {
      current: { ...current, segmentIndex: 1 },
    });

    const question = seen[1]?.question ?? "";
    expect(question).toContain("Then the upload.");
    expect(question).toContain("uploadClip");
    expect(question).not.toContain("save(clip: string)");
  });

  it("sends the question alone when there is no current position or the tour is unknown", async () => {
    const { conversation, seen } = await afterTour();

    await run([{ type: "done", usage }], conversation, seen);
    await run([{ type: "done", usage }], conversation, seen, {
      current: { ...current, tour: "A tour that was never finished" },
    });
    await run([{ type: "done", usage }], conversation, seen, {
      current: { ...current, step: 7 },
    });

    expect(seen.slice(1).map((request) => request.question)).toEqual([
      "What does that return?",
      "What does that return?",
      "What does that return?",
    ]);
  });

  it("describes a step of a tour whose ask was interrupted", async () => {
    const conversation = createConversation();
    const seen: LLMRequest[] = [];
    const controller = new AbortController();
    const interrupted: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
      },
    };
    await collect(
      askEvents({
        root,
        provider: interrupted,
        conversation,
        question: earlierQuestion,
        ack: "One moment.",
        signal: controller.signal,
      }),
    );

    await run([{ type: "done", usage }], conversation, seen, { current });

    expect(seen[0]?.question).toContain("Clips are saved here.");
  });

  it("wraps the step title and the segment text as untrusted model output", async () => {
    const { conversation, seen } = await afterTour();

    await run([{ type: "done", usage }], conversation, seen, { current });

    expect(seen[1]?.question).toMatch(
      /<untrusted_content tool="tour_position">[^<]*Saving a clip[^<]*Clips are saved here\.[^<]*<\/untrusted_content>/,
    );
  });

  it("redacts secrets in the step it describes", async () => {
    const { conversation, seen } = await afterTour({
      ...saveStep,
      narration: [{ text: `The key is ${key}.`, anchor: 0 }],
    });

    await run([{ type: "done", usage }], conversation, seen, { current });

    expect(seen[1]?.question).not.toContain(key);
  });

  it("puts the model's scope on the finished tour and in the conversation record", async () => {
    const conversation = createConversation();
    const seen: LLMRequest[] = [];

    const events = await run(
      [
        { type: "step", step: saveStep },
        { type: "scope", scope: "new" },
        { type: "done", usage },
      ],
      conversation,
      seen,
    );

    expect(events.find((event) => event.type === "tour")).toMatchObject({
      tour: { scope: "new" },
    });
    await run([{ type: "done", usage }], conversation, seen);
    expect(seen[1]?.conversation).toContain('{"scope":"new"}');
  });

  it("finds the earlier tour even after a side answer was added after it", async () => {
    const { conversation, seen } = await afterTour();
    await run(
      [
        { type: "text", text: "A clip is one recording." },
        { type: "done", usage },
      ],
      conversation,
      seen,
      { question: "What is a clip?", current },
    );

    await run([{ type: "done", usage }], conversation, seen, { current });

    expect(seen[2]?.question).toContain("Clips are saved here.");
  });
});
