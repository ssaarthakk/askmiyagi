import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentMessage } from "./agent-message.ts";
import {
  type AskEvent,
  askEventSchema,
  type ProviderEvent,
  providerEventSchema,
} from "./events.ts";
import { type LLMRequest, llmRequestSchema } from "./llm-request.ts";
import { parseContract } from "./parse.ts";
import { resultSchema } from "./result.ts";
import { toolResultSchema } from "./tool-result.ts";
import type { Step } from "./tour.ts";
import { type Usage, usageSchema } from "./usage.ts";

const step: Step = {
  title: "Saving a clip",
  anchors: [{ file: "src/clip.ts", symbol: "save" }],
  narration: [{ text: "It saves." }],
};
const usage: Usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 2,
  costUsd: null,
};
const range = { file: "src/clip.ts", start: 1, end: 4, capped: false };
const messages: AgentMessage[] = [
  { role: "user", text: "How is a clip saved?" },
  {
    role: "assistant",
    text: "",
    toolCalls: [{ id: "c1", name: "read_file", input: { path: "src/clip.ts" } }],
  },
  {
    role: "tool",
    outputs: [{ callId: "c1", name: "read_file", text: "export {}", isError: false }],
  },
  { role: "assistant", text: "It is saved here.", toolCalls: [] },
];

describe("Result", () => {
  const schema = resultSchema(z.number());

  it("accepts both outcomes and checks the value", () => {
    expect(parseContract(schema, { ok: true, value: 1 }).ok).toBe(true);
    expect(parseContract(schema, { ok: false, error: "bad" }).ok).toBe(true);
    expect(parseContract(schema, { ok: true, value: "one" }).ok).toBe(false);
    expect(parseContract(schema, { ok: false }).ok).toBe(false);
  });
});

describe("ToolResult and Usage", () => {
  it("validates a tool result", () => {
    expect(parseContract(toolResultSchema, { text: "ok", isError: false }).ok).toBe(true);
    expect(parseContract(toolResultSchema, { text: "ok" }).ok).toBe(false);
  });

  it("accepts a null or numeric cost and rejects negative counts", () => {
    expect(parseContract(usageSchema, usage).ok).toBe(true);
    expect(parseContract(usageSchema, { ...usage, costUsd: 0.12 }).ok).toBe(true);
    expect(parseContract(usageSchema, { ...usage, inputTokens: -1 }).ok).toBe(false);
    expect(parseContract(usageSchema, { ...usage, costUsd: undefined }).ok).toBe(false);
  });
});

describe("LLMRequest", () => {
  const request: LLMRequest = {
    system: "s",
    context: "c",
    conversation: "",
    history: [],
    question: "q",
    root: "/repo",
    tools: true,
    model: "strong",
  };

  it("accepts a request and rejects an unknown model", () => {
    expect(parseContract(llmRequestSchema, request).ok).toBe(true);
    const result = parseContract(llmRequestSchema, { ...request, model: "huge" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("model");
  });

  it("carries earlier turns as agent messages and rejects a malformed one", () => {
    expect(parseContract(llmRequestSchema, { ...request, history: messages }).ok).toBe(true);
    const bad = { ...request, history: [{ role: "tool", outputs: [{ callId: "c1" }] }] };
    const result = parseContract(llmRequestSchema, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("history");
    expect(parseContract(llmRequestSchema, { ...request, history: undefined }).ok).toBe(false);
  });
});

describe("ProviderEvent", () => {
  it("accepts every event type", () => {
    const events: ProviderEvent[] = [
      { type: "text", text: "hi" },
      { type: "step", step },
      { type: "checkQuestion", text: "What does save return?" },
      { type: "checkQuestion", text: "What does save return?", concept: "upload retries" },
      { type: "tool_call", name: "grep", input: { patterns: ["a"] } },
      { type: "done", usage },
      { type: "done", usage, messages },
      { type: "error", message: "boom", retryable: true },
    ];
    for (const event of events) {
      expect(parseContract(providerEventSchema, event)).toEqual({ ok: true, value: event });
    }
  });

  it("rejects an unknown type, and a step event holding an invalid step", () => {
    expect(parseContract(providerEventSchema, { type: "nope" }).ok).toBe(false);
    const bad = { type: "step", step: { ...step, anchors: [] } };
    const result = parseContract(providerEventSchema, bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("step.anchors");
  });

  it("requires retryable on an error event", () => {
    expect(parseContract(providerEventSchema, { type: "error", message: "boom" }).ok).toBe(false);
  });
});

describe("AskEvent", () => {
  it("accepts every event type, with null ranges for unresolved anchors", () => {
    const events: AskEvent[] = [
      { type: "ack", text: "On it." },
      { type: "progress", text: "Reading the clip service." },
      { type: "step", step, ranges: [range] },
      { type: "step", step, ranges: [null] },
      { type: "tour", tour: { question: "q", steps: [step] }, ranges: [[range]] },
      { type: "error", message: "boom" },
      { type: "done" },
    ];
    for (const event of events) {
      expect(parseContract(askEventSchema, event)).toEqual({ ok: true, value: event });
    }
  });

  it("rejects a step event whose ranges are malformed", () => {
    const bad = { type: "step", step, ranges: [{ file: "a.ts" }] };
    expect(parseContract(askEventSchema, bad).ok).toBe(false);
  });
});
