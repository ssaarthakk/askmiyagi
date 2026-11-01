import type { AgentMessage, ToolCall } from "../../shared/agent-message.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { ToolResult } from "../../shared/tool-result.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { addUsage, noUsage, type Usage } from "../../shared/usage.ts";
import { toolResult } from "../tools/run-tool.ts";

type ToolOutput = Extract<AgentMessage, { role: "tool" }>["outputs"][number];

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  run(input: unknown): Promise<ToolResult>;
};

export type ModelStep = { text: string; toolCalls: ToolCall[]; usage: Usage };

export type AgentModel = {
  step(messages: AgentMessage[], tools: AgentTool[], signal: AbortSignal): Promise<ModelStep>;
};

type StopReason =
  | "tool_limit"
  | "time_limit"
  | "budget"
  | "repeated_call"
  | "tool_errors"
  | "aborted";

type AgentResult = {
  text: string;
  usage: Usage;
  messages: AgentMessage[];
  stopped?: StopReason;
};

type AgentOptions = {
  model: AgentModel;
  tools: AgentTool[];
  messages: AgentMessage[];
  signal: AbortSignal;
  spent?: Usage | undefined;
  startedAt?: number | undefined;
};

const maxToolCalls = 20;
const warnBeforeCap = 3;
const timeLimitMs = 90_000;
const tokenBudget = 150_000;
const costBudgetUsd = 1;
const maxErrorsInRow = 3;

const stopNotes: Record<StopReason, string> = {
  tool_limit: "You have used all your tool calls.",
  time_limit: "You have run out of time.",
  budget: "You have used up your token or cost budget.",
  repeated_call: "You repeated a tool call you had already made.",
  tool_errors: "Your last three tool calls failed.",
  aborted: "The learner stopped the answer.",
};

function overBudget(usage: Usage) {
  const tokens =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return tokens >= tokenBudget || (usage.costUsd !== null && usage.costUsd >= costBudgetUsd);
}

function callKey({ name, input }: ToolCall) {
  const sortedKeys = (_: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value;
  return JSON.stringify([name, input], sortedKeys);
}

export async function* runAgentLoop({
  model,
  tools,
  messages: initial,
  signal,
  spent = noUsage,
  startedAt = Date.now(),
}: AgentOptions): AsyncGenerator<Extract<ProviderEvent, { type: "tool_call" }>, AgentResult> {
  const messages = [...initial];
  const withAnswer = (text: string): AgentMessage[] => [
    ...messages,
    { role: "assistant", text, toolCalls: [] },
  ];
  const seenCalls = new Set<string>();
  let usage = noUsage;
  let executed = 0;
  let errorsInRow = 0;

  const runStop = (): StopReason | undefined => {
    if (signal.aborted) return "aborted";
    if (Date.now() - startedAt >= timeLimitMs) return "time_limit";
    if (overBudget(addUsage(spent, usage))) return "budget";
    if (errorsInRow >= maxErrorsInRow) return "tool_errors";
    return undefined;
  };

  let stopped = runStop();
  while (!stopped) {
    const step = await model.step(messages, tools, signal);
    usage = addUsage(usage, step.usage);
    if (step.toolCalls.length === 0) {
      return { text: step.text, usage, messages: withAnswer(step.text) };
    }
    messages.push({ role: "assistant", text: step.text, toolCalls: step.toolCalls });

    const executedBefore = executed;
    const outputs: ToolOutput[] = [];
    for (const call of step.toolCalls) {
      const key = callKey(call);
      stopped ??=
        runStop() ??
        (executed >= maxToolCalls
          ? "tool_limit"
          : seenCalls.has(key)
            ? "repeated_call"
            : undefined);
      if (stopped) {
        outputs.push({
          callId: call.id,
          name: call.name,
          text: `Not run. ${stopNotes[stopped]}`,
          isError: true,
        });
        continue;
      }
      yield { type: "tool_call", name: call.name, input: call.input };
      seenCalls.add(key);
      executed++;
      const tool = tools.find(({ name }) => name === call.name);
      const result = tool
        ? await tool.run(call.input)
        : toolResult(`Unknown tool: ${call.name}`, true);
      errorsInRow = result.isError ? errorsInRow + 1 : 0;
      outputs.push({
        callId: call.id,
        name: call.name,
        text: wrapUntrusted(tool ? call.name : "unknown", result.text),
        isError: result.isError,
      });
      stopped = runStop();
    }

    const last = outputs.at(-1);
    if (
      last &&
      executedBefore < maxToolCalls - warnBeforeCap &&
      executed >= maxToolCalls - warnBeforeCap
    ) {
      last.text = [last.text, `${warnBeforeCap} steps left, wrap up.`].join("\n");
    }
    messages.push({ role: "tool", outputs });
  }

  if (stopped === "aborted") return { text: "", usage, messages, stopped };
  messages.push({
    role: "user",
    text: `${stopNotes[stopped]} Answer now without tools, using only what you have already read. Be honest that this is a partial answer.`,
  });
  const final = await model.step(messages, [], signal);
  return {
    text: final.text,
    usage: addUsage(usage, final.usage),
    messages: withAnswer(final.text),
    stopped,
  };
}
