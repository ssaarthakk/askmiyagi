import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(
  events: ProviderEvent[],
  options: { intent?: "interview" | "onboarding" | "contributing" | "debugging" } = {},
  conversation = createConversation(),
) {
  const seen: LLMRequest[] = [];
  const emitted = await collect(
    askEvents({
      root,
      provider: scripted(events, seen),
      conversation,
      question: "How are clips saved?",
      ack: "One moment.",
      signal: new AbortController().signal,
      ...options,
    }),
  );
  return { seen, emitted, conversation };
}

const tourOf = (emitted: Awaited<ReturnType<typeof run>>["emitted"]) =>
  emitted.find((event) => event.type === "tour");

describe("askEvents question intent", () => {
  it("puts the intent the model reports on the finished tour", async () => {
    const { emitted } = await run([
      { type: "step", step: saveStep },
      { type: "intent", intent: "debugging" },
      { type: "done", usage },
    ]);

    expect(tourOf(emitted)).toMatchObject({ tour: { intent: "debugging" } });
  });

  it("leaves the intent out when the model reports none", async () => {
    const { emitted } = await run([
      { type: "step", step: saveStep },
      { type: "done", usage },
    ]);

    expect(tourOf(emitted)).not.toHaveProperty("tour.intent");
  });

  it("tells the model the learner's chosen intent and keeps it over the model's own", async () => {
    const { seen, emitted } = await run(
      [
        { type: "step", step: saveStep },
        { type: "intent", intent: "debugging" },
        { type: "done", usage },
      ],
      { intent: "interview" },
    );

    expect(seen[0]?.question).toMatch(/learner chose.*interview/i);
    expect(tourOf(emitted)).toMatchObject({ tour: { intent: "interview" } });
  });

  it("does not mention an intent to the model when none was chosen", async () => {
    const { seen } = await run([
      { type: "step", step: saveStep },
      { type: "done", usage },
    ]);

    expect(seen[0]?.question).not.toMatch(/learner chose/i);
  });

  it("shows the model its earlier intent in the conversation", async () => {
    const first = await run([
      { type: "step", step: saveStep },
      { type: "scope", scope: "side" },
      { type: "intent", intent: "onboarding" },
      { type: "done", usage },
    ]);

    const second = await run([{ type: "done", usage }], {}, first.conversation);

    expect(second.seen[0]?.conversation).toContain('"intent":"onboarding"');
    expect(second.seen[0]?.conversation).toContain('"scope":"side"');
  });
});
