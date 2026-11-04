import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkEvents,
  questionOptions,
  saveStep,
  scripted,
  stream,
  usage,
} from "../../../test/ask-helpers.ts";
import { turnMessages } from "../../../test/conversation-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { createConversation } from "./conversation.ts";
import type { LLMProvider } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askEvents conversation", () => {
  const finished: ProviderEvent[] = [
    { type: "step", step: saveStep },
    ...checkEvents,
    { type: "done", usage },
  ];

  it("sends the first question and a record of its tour with the next request", async () => {
    const conversation = createConversation();
    const seen: LLMRequest[] = [];
    await collect(stream(scripted(finished, seen), undefined, conversation, questionOptions()));
    expect(seen[0]?.conversation).toBe("");

    await collect(stream(scripted(finished, seen), undefined, conversation));
    expect(seen[1]?.conversation).toContain("How are clips saved?");
    expect(seen[1]?.conversation).toContain("Saving a clip");
    expect(seen[1]?.conversation).toContain("What does save return?");
  });

  describe("agent messages", () => {
    const fileResult = '<untrusted_content tool="read_file">contents 1</untrusted_content>';
    const messages = turnMessages(1);
    const withMessages: ProviderEvent[] = [
      { type: "step", step: saveStep },
      { type: "done", usage, messages },
    ];

    it("sends the messages a finished ask handed back with the next request", async () => {
      const conversation = createConversation();
      const seen: LLMRequest[] = [];
      await collect(stream(scripted(withMessages, seen), undefined, conversation));
      await collect(stream(scripted(withMessages, seen), undefined, conversation));
      expect(seen[0]?.history).toEqual([]);
      expect(seen[1]?.history).toEqual(messages);
    });

    it("replaces old tool results in the request once the context passes half the budget", async () => {
      const conversation = createConversation({ contextTokens: 100 });
      const seen: LLMRequest[] = [];
      for (let ask = 0; ask < 5; ask++) {
        await collect(stream(scripted(withMessages, seen), undefined, conversation));
      }
      const asks = seen.filter((request) => request.tools);
      const results = (request?: LLMRequest) =>
        request?.history.flatMap((message) =>
          message.role === "tool" ? message.outputs.map((output) => output.text) : [],
        );
      expect(results(asks[3])).toEqual([fileResult, fileResult, fileResult]);
      expect(results(asks[4])).toEqual([
        "[read_file result removed]",
        fileResult,
        fileResult,
        fileResult,
      ]);
    });
  });

  describe("summaries", () => {
    const summaryEvents: ProviderEvent[] = [
      { type: "text", text: "They asked about saving clips." },
      { type: "done", usage },
    ];

    function summarising(seen: LLMRequest[]): LLMProvider {
      return {
        async *ask(request) {
          seen.push(request);
          yield* request.tools ? finished : summaryEvents;
        },
      };
    }

    async function askTimes(conversation: ReturnType<typeof createConversation>, count: number) {
      const seen: LLMRequest[] = [];
      const provider = summarising(seen);
      for (let ask = 0; ask < count; ask++) {
        await collect(stream(provider, undefined, conversation));
      }
      return seen;
    }

    it("summarises older turns after an ask that leaves the context over 70% of the budget", async () => {
      const conversation = createConversation({ contextTokens: 100 });
      const seen = await askTimes(conversation, 4);
      await vi.waitFor(() => expect(conversation.render()).toContain("They asked about saving"));
      const summaryRequests = seen.filter((request) => !request.tools);
      expect(summaryRequests).toHaveLength(1);
      expect(summaryRequests[0]?.model).toBe("small");
    });

    it("sends the summary with the next ask", async () => {
      const conversation = createConversation({ contextTokens: 100 });
      await askTimes(conversation, 4);
      await vi.waitFor(() => expect(conversation.render()).toContain("They asked about saving"));
      const seen = await askTimes(conversation, 1);
      expect(seen[0]?.conversation).toContain("They asked about saving clips.");
    });

    it("does not delay the end of the ask", async () => {
      const conversation = createConversation({ contextTokens: 100 });
      const provider: LLMProvider = {
        async *ask(request) {
          if (request.tools) yield* finished;
          else await new Promise(() => {});
        },
      };
      for (let ask = 0; ask < 5; ask++) {
        await collect(stream(provider, undefined, conversation));
      }
      expect(conversation.render()).toContain("Saving a clip");
    });
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

  it("keeps the steps an aborted ask had sent as a partial turn", async () => {
    const conversation = createConversation();
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
      },
    };
    await collect(stream(provider, controller.signal, conversation));
    expect(conversation.render()).toContain(saveStep.title);
  });

  it("keeps the partial turn when the provider throws after the abort", async () => {
    const conversation = createConversation();
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
        throw new Error("The operation was aborted");
      },
    };
    await collect(stream(provider, controller.signal, conversation));
    expect(conversation.render()).toContain(saveStep.title);
  });

  it("stores nothing for an ask aborted before any step", async () => {
    const conversation = createConversation();
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        controller.abort();
        yield { type: "step", step: saveStep };
      },
    };
    await collect(stream(provider, controller.signal, conversation));
    expect(conversation.render()).toBe("");
  });
});
