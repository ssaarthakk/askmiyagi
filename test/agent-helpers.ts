import type { AgentModel, AgentTool, ModelStep } from "../src/server/llm/agent-loop.ts";
import { runAgentLoop } from "../src/server/llm/agent-loop.ts";
import type { AgentMessage, ToolCall } from "../src/shared/agent-message.ts";
import type { ToolResult } from "../src/shared/tool-result.ts";
import type { Usage } from "../src/shared/usage.ts";

function usage(part: Partial<Usage> = {}): Usage {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    ...part,
  };
}

export function call(name: string, input: unknown = {}, id = `${name}-${JSON.stringify(input)}`) {
  return { id, name, input } satisfies ToolCall;
}

export function modelStep(text: string, toolCalls: ToolCall[] = [], part: Partial<Usage> = {}) {
  return { text, toolCalls, usage: usage(part) } satisfies ModelStep;
}

export function numberedCalls(count: number) {
  return Array.from({ length: count }, (_, n) => modelStep("", [call("read_file", { n })]));
}

export function scriptedModel(script: (ModelStep | (() => ModelStep))[]) {
  const seen: { messages: AgentMessage[]; tools: AgentTool[] }[] = [];
  const model: AgentModel = {
    async step(messages, tools) {
      seen.push({ messages: [...messages], tools });
      const next = script[seen.length - 1];
      if (!next) throw new Error("the script has no more steps");
      return typeof next === "function" ? next() : next;
    },
  };
  return { model, seen };
}

export function ok(text: string): ToolResult {
  return { text, isError: false };
}

export function failed(text: string): ToolResult {
  return { text, isError: true };
}

export function tool(name: string, run: (input: unknown) => ToolResult = () => ok("fine")) {
  const runs: unknown[] = [];
  const agentTool: AgentTool = {
    name,
    description: name,
    inputSchema: { type: "object" },
    async run(input) {
      runs.push(input);
      return run(input);
    },
  };
  return { agentTool, runs };
}

export async function drive(
  model: AgentModel,
  tools: AgentTool[],
  signal = new AbortController().signal,
  spent?: Usage,
  startedAt?: number,
) {
  const generator = runAgentLoop({
    model,
    tools,
    messages: [{ role: "user", text: "How are clips saved?" }],
    signal,
    spent,
    startedAt,
  });
  const events = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

export function toolOutputs(messages: AgentMessage[] = []) {
  return messages.flatMap((message) => (message.role === "tool" ? message.outputs : []));
}
