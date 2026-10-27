import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Step } from "../../shared/tour.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";
import { type LLMProvider, lostThread } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function terminal() {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return () => write.mock.calls.map(([text]) => String(text)).join("");
}

const root = resolve(import.meta.dirname, "../../../test/fixtures/basic");

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

const saveStep: Step = {
  title: "Saving a clip",
  anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
  narration: [{ text: "Clips are saved here.", anchor: 0 }],
};

const uploadStep: Step = {
  title: "Uploading",
  anchors: [
    { file: "src/upload.ts", symbol: "uploadClip" },
    { file: "src/missing.ts", symbol: "nothing" },
  ],
  narration: [{ text: "Then the clip is uploaded." }],
};

function scripted(events: ProviderEvent[], seen: LLMRequest[] = []): LLMProvider {
  return {
    async *ask(request) {
      seen.push(request);
      yield* events;
    },
  };
}

function stream(
  provider: LLMProvider,
  signal = new AbortController().signal,
  conversation = createConversation(),
) {
  return askEvents({
    root,
    provider,
    question: "How are clips saved?",
    ack: "One moment.",
    signal,
    conversation,
  });
}

describe("askEvents", () => {
  it("sends the acknowledgement before the provider is asked", async () => {
    const seen: LLMRequest[] = [];
    const events = stream(scripted([{ type: "done", usage }], seen));
    expect((await events.next()).value).toEqual({ type: "ack", text: "One moment." });
    expect(seen).toEqual([]);
    await events.return(undefined);
  });

  it("sends a progress line only once per ask", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "tool_call", name: "read_file", input: { path: "src/cli.ts" } },
          { type: "tool_call", name: "read_file", input: { path: "src/cli.ts" } },
          { type: "tool_call", name: "read_file", input: { path: "src/upload.ts" } },
          { type: "tool_call", name: "read_file", input: { path: "src/cli.ts" } },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.filter((event) => event.type === "progress")).toEqual([
      { type: "progress", text: "Looking at cli.ts" },
      { type: "progress", text: "Looking at upload.ts" },
    ]);
  });

  it("turns tool calls into progress lines", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "tool_call", name: "read_file", input: { path: "src/clip-service.ts" } },
          { type: "tool_call", name: "grep", input: { patterns: ["upload", "post", "publish"] } },
          { type: "tool_call", name: "find_symbol", input: { name: "ClipService.save" } },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.filter((event) => event.type === "progress")).toEqual([
      { type: "progress", text: "Looking at clip-service.ts" },
      { type: "progress", text: "Searching for upload or post or publish" },
      { type: "progress", text: "Finding ClipService.save" },
    ]);
  });

  it("sends each step with its resolved ranges, then the tour, then done", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "step", step: uploadStep },
          { type: "checkQuestion", text: "What does save return?" },
          { type: "done", usage },
        ]),
      ),
    );
    const saveRanges = [{ file: "src/clip-service.ts", start: 2, end: 4, capped: false }];
    const uploadRanges = [{ file: "src/upload.ts", start: 1, end: 3, capped: false }, null];
    expect(events).toEqual([
      { type: "ack", text: "One moment." },
      { type: "step", step: saveStep, ranges: saveRanges },
      { type: "step", step: uploadStep, ranges: uploadRanges },
      {
        type: "tour",
        tour: {
          question: "How are clips saved?",
          steps: [saveStep, uploadStep],
          checkQuestion: "What does save return?",
        },
        ranges: [saveRanges, uploadRanges],
      },
      { type: "done" },
    ]);
  });

  it("leaves the check question out of the tour when the model gave none", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "done", usage },
        ]),
      ),
    );
    const tour = events.find((event) => event.type === "tour");
    expect(tour?.tour).toEqual({ question: "How are clips saved?", steps: [saveStep] });
  });

  it("ends the ask with an error after an invalid step, keeping the steps already sent", async () => {
    const printed = terminal();
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          {
            type: "error",
            message: lostThread,
            detail: "title: must not be empty",
            retryable: false,
          },
          { type: "step", step: uploadStep },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "error"]);
    expect(events.at(-1)).toEqual({ type: "error", message: lostThread });
    expect(printed()).toContain("Ask failed: title: must not be empty");
  });

  it("keeps the steps and ignores stray text around them", async () => {
    terminal();
    const events = await collect(
      stream(
        scripted([
          { type: "text", text: "Sure! Here is the tour" },
          { type: "step", step: saveStep },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "tour", "done"]);
  });

  it("turns plain text with no steps into a spoken reply", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "text", text: "That's fine." },
          { type: "text", text: "Ask me about any part of it." },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.find((event) => event.type === "tour")).toMatchObject({
      tour: { steps: [], reply: "That's fine. Ask me about any part of it." },
    });
  });

  it("turns a thrown provider failure into an error event", async () => {
    const failing: LLMProvider = {
      async *ask() {
        yield* [];
        throw new Error("Claude Code was not found.");
      },
    };
    expect(await collect(stream(failing))).toEqual([
      { type: "ack", text: "One moment." },
      { type: "error", message: "Claude Code was not found." },
    ]);
  });

  it("builds the request from the question", async () => {
    const requests: LLMRequest[] = [];
    await collect(stream(scripted([{ type: "done", usage }], requests)));
    expect(requests[0]?.question).toBe("How are clips saved?");
  });

  it("redacts a secret in the question before it reaches the provider, keeping it in the tour", async () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const question = `Why does ${key} fail?`;
    const seen: LLMRequest[] = [];
    const events = await collect(
      askEvents({
        root,
        provider: scripted([{ type: "done", usage }], seen),
        question,
        ack: "One moment.",
        signal: new AbortController().signal,
        conversation: createConversation(),
      }),
    );
    expect(JSON.stringify(seen)).not.toContain("sk-ant-");
    expect(seen[0]?.question).toBe("Why does [REDACTED] fail?");
    const tour = events.find((event) => event.type === "tour");
    expect(tour?.tour.question).toBe(question);
  });

  it("stops without a tour or done when the signal is aborted", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
        yield { type: "step", step: uploadStep };
        yield { type: "done", usage };
      },
    };
    const events = await collect(stream(provider, controller.signal));
    expect(events.map((event) => event.type)).toEqual(["ack", "step"]);
  });
});

describe("askEvents conversation", () => {
  const finished: ProviderEvent[] = [
    { type: "step", step: saveStep },
    { type: "checkQuestion", text: "What does save return?" },
    { type: "done", usage },
  ];

  it("sends the first question and a record of its tour with the next request", async () => {
    const conversation = createConversation();
    const seen: LLMRequest[] = [];
    await collect(stream(scripted(finished, seen), undefined, conversation));
    expect(seen[0]?.conversation).toBe("");

    await collect(stream(scripted(finished, seen), undefined, conversation));
    expect(seen[1]?.conversation).toContain("How are clips saved?");
    expect(seen[1]?.conversation).toContain("Saving a clip");
    expect(seen[1]?.conversation).toContain("What does save return?");
  });

  it("does not store an ask that ended in an error", async () => {
    const conversation = createConversation();
    await collect(
      stream(
        scripted([{ type: "error", message: "boom", retryable: false }]),
        undefined,
        conversation,
      ),
    );
    expect(conversation.render()).toBe("");
  });

  it("does not store an ask that produced no steps", async () => {
    const conversation = createConversation();
    await collect(stream(scripted([{ type: "done", usage }]), undefined, conversation));
    expect(conversation.render()).toBe("");
  });

  it("does not store an ask that was aborted", async () => {
    const conversation = createConversation();
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
      },
    };
    await collect(stream(provider, controller.signal, conversation));
    expect(conversation.render()).toBe("");
  });
});
