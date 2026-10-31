import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, terminal, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";
import type { LLMProvider } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askEvents call log", () => {
  const fullUsage = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    costUsd: 0.05,
  };

  async function logged(
    provider: LLMProvider,
    signal = new AbortController().signal,
    bruteForceTokens?: number,
  ) {
    const records: Record<string, unknown>[] = [];
    await collect(
      askEvents({
        root,
        provider,
        question: "How are clips saved?",
        ack: "One moment.",
        signal,
        conversation: createConversation(),
        bruteForceTokens,
        callLog: {
          provider: "fake",
          write: async (record) => {
            records.push(record);
          },
        },
      }),
    );
    return records;
  }

  it("logs one record for a finished ask", async () => {
    const records = await logged(
      scripted([
        { type: "tool_call", name: "read_file", input: { path: "src/upload.ts" } },
        { type: "step", step: saveStep },
        { type: "done", usage: fullUsage },
      ]),
    );
    expect(records).toEqual([
      {
        callType: "ask",
        provider: "fake",
        mode: "brute-force",
        startedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        ackMs: expect.any(Number),
        firstContentMs: expect.any(Number),
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        costUsd: 0.05,
        filesOpened: ["src/upload.ts"],
        outcome: "done",
      },
    ]);
  });

  it("logs the agentic mode when the repo is too big to send whole", async () => {
    const records = await logged(
      scripted([{ type: "done", usage }]),
      new AbortController().signal,
      1,
    );
    expect(records[0]?.mode).toBe("agentic");
  });

  it("lists each file opened once, including refused attempts, and ignores other tools", async () => {
    const records = await logged(
      scripted([
        { type: "tool_call", name: "read_file", input: { path: "src/upload.ts" } },
        { type: "tool_call", name: "read_file", input: { path: ".env" } },
        { type: "tool_call", name: "read_file", input: { path: "src/upload.ts", start: 1 } },
        { type: "tool_call", name: "read_file", input: { path: "src/bad-range.ts", start: 0 } },
        { type: "tool_call", name: "grep", input: { patterns: ["upload"] } },
        { type: "tool_call", name: "read_file", input: { nonsense: true } },
        { type: "done", usage },
      ]),
    );
    expect(records[0]?.filesOpened).toEqual(["src/upload.ts", ".env", "src/bad-range.ts"]);
  });

  it.each([
    { content: "step", event: { type: "step", step: saveStep } },
    { content: "text", event: { type: "text", text: "Clips are saved by the clip service." } },
  ] as const)("measures time to first content from the first $content", async ({ event }) => {
    const slow: LLMProvider = {
      async *ask() {
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield event;
        yield { type: "done", usage };
      },
    };
    const [record] = await logged(slow);
    expect(record?.firstContentMs).toBeGreaterThanOrEqual(50);
    expect(record?.ackMs).toBeLessThan(50);
  });

  it("logs an error outcome when the reply is not plain speech", async () => {
    terminal();
    const records = await logged(
      scripted([
        { type: "text", text: '{"x":1}' },
        { type: "done", usage },
      ]),
    );
    expect(records[0]).toMatchObject({ outcome: "error" });
  });

  it("measures time to ack until the ack is taken by the consumer", async () => {
    const records: CallRecord[] = [];
    const events = askEvents({
      root,
      provider: scripted([{ type: "done", usage }]),
      question: "How are clips saved?",
      ack: "One moment.",
      signal: new AbortController().signal,
      conversation: createConversation(),
      callLog: {
        provider: "fake",
        write: async (record) => {
          records.push(record);
        },
      },
    });
    expect((await events.next()).value).toMatchObject({ type: "ack" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await collect(events);
    expect(records[0]?.ackMs).toBeGreaterThanOrEqual(50);
  });

  it("logs null for time to first content when nothing came", async () => {
    const records = await logged(scripted([{ type: "done", usage }]));
    expect(records[0]).toMatchObject({ firstContentMs: null, outcome: "done" });
  });

  it("logs an error outcome with the usage as zeros and cost as null", async () => {
    terminal();
    const records = await logged(scripted([{ type: "error", message: "boom", retryable: false }]));
    expect(records[0]).toMatchObject({
      outcome: "error",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    });
  });

  it("logs an error outcome when the provider throws", async () => {
    terminal();
    const failing: LLMProvider = {
      async *ask() {
        yield* [];
        throw new Error("Claude Code was not found.");
      },
    };
    expect((await logged(failing))[0]).toMatchObject({ outcome: "error" });
  });

  it("logs an aborted outcome when the signal is aborted", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
        yield { type: "done", usage };
      },
    };
    expect((await logged(provider, controller.signal))[0]).toMatchObject({ outcome: "aborted" });
  });
});
