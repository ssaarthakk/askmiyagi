import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { TourConcept } from "../../shared/learner.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const retries: TourConcept = { name: "upload retries", important: true, kind: "repo" };

async function run(
  events: ProviderEvent[],
  markSeen = vi.fn<(concepts: TourConcept[]) => Promise<void>>(async () => undefined),
  signal = new AbortController().signal,
) {
  const conversation = createConversation();
  const emitted = await collect(
    askEvents({
      root,
      provider: scripted(events),
      conversation,
      question: "How are clips saved?",
      ack: "One moment.",
      signal,
      markSeen,
    }),
  );
  return { emitted, markSeen, conversation };
}

describe("askEvents learner record", () => {
  it("puts the concepts the model reports on the finished tour and keeps them for the conversation", async () => {
    const { emitted, conversation } = await run([
      { type: "step", step: saveStep },
      { type: "concepts", concepts: [retries] },
      { type: "done", usage },
    ]);

    expect(emitted.find((event) => event.type === "tour")).toMatchObject({
      tour: { concepts: [retries] },
    });
    expect(conversation.turnAsked("How are clips saved?")?.tour.concepts).toEqual([retries]);
  });

  it("ends the ask without waiting for the learner record to be written", async () => {
    const neverWritten = vi.fn(() => new Promise<void>(() => undefined));

    const { emitted, markSeen } = await run(
      [
        { type: "step", step: saveStep },
        { type: "concepts", concepts: [retries] },
        { type: "done", usage },
      ],
      neverWritten,
    );

    expect(markSeen).toHaveBeenCalledExactlyOnceWith([retries]);
    expect(emitted.at(-1)).toEqual({ type: "done" });
  });

  it("marks nothing when the model reports no concepts", async () => {
    const { markSeen } = await run([
      { type: "step", step: saveStep },
      { type: "done", usage },
    ]);

    expect(markSeen).not.toHaveBeenCalled();
  });

  it("marks nothing when the ask fails or is aborted", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const failed = await run([
      { type: "step", step: saveStep },
      { type: "concepts", concepts: [retries] },
      { type: "error", message: "boom", retryable: false },
    ]);
    const controller = new AbortController();
    controller.abort();
    const aborted = await run(
      [
        { type: "step", step: saveStep },
        { type: "concepts", concepts: [retries] },
        { type: "done", usage },
      ],
      undefined,
      controller.signal,
    );

    expect(failed.markSeen).not.toHaveBeenCalled();
    expect(aborted.markSeen).not.toHaveBeenCalled();
  });
});
