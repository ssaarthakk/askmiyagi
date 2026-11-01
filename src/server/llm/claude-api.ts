import Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage, ToolCall } from "../../shared/agent-message.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Usage } from "../../shared/usage.ts";
import { agentProvider, cutOffError, ModelStopError } from "./agent-events.ts";
import type { AgentModel, AgentTool } from "./agent-loop.ts";
import type { LLMProvider } from "./provider.ts";

type MessagesClient = {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options: { signal: AbortSignal },
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
};

const defaultModel = "claude-opus-5-5";
const maxTokens = 16000;
const cacheMarker = { type: "ephemeral" } as const;
const contentByToolCalls = new WeakMap<ToolCall[], Anthropic.ContentBlock[]>();

const pricesPerMillionTokens = new Map([
  ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
]);

function usageOf(model: string, usage: Anthropic.Usage): Usage {
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const price = pricesPerMillionTokens.get(model);
  const costUsd = price
    ? (inputTokens * price.input +
        outputTokens * price.output +
        cacheReadTokens * price.cacheRead +
        cacheWriteTokens * price.cacheWrite) /
      1_000_000
    : null;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };
}

function anthropicModel(
  client: MessagesClient,
  model: string,
  request: LLMRequest,
  tools: AgentTool[],
): AgentModel {
  const definitions = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    input_schema: inputSchema,
  }));
  const effort = request.model === "small" ? "low" : "medium";
  const lastEarlier = request.history.length - 1;

  const textBlock = (text: string, marked = false) => ({
    type: "text" as const,
    text,
    ...(marked ? { cache_control: cacheMarker } : {}),
  });

  function toParam(message: AgentMessage, index: number): Anthropic.MessageParam {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: contentByToolCalls.get(message.toolCalls) ?? [
          textBlock(message.text, index === lastEarlier),
        ],
      };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        content: message.outputs.map((output) => ({
          type: "tool_result" as const,
          tool_use_id: output.callId,
          content: output.text,
          is_error: output.isError,
        })),
      };
    }
    const prefix = index === 0 && request.context !== "" ? [textBlock(request.context, true)] : [];
    return { role: "user", content: [...prefix, textBlock(message.text)] };
  }

  return {
    async step(messages, offered, signal) {
      const message = await client.messages
        .stream(
          {
            model,
            max_tokens: maxTokens,
            system: request.system,
            messages: messages.map(toParam),
            output_config: { effort },
            ...(definitions.length > 0
              ? {
                  tools: definitions,
                  tool_choice: { type: offered.length > 0 ? ("auto" as const) : ("none" as const) },
                }
              : {}),
          },
          { signal },
        )
        .finalMessage();
      if (message.stop_reason === "refusal") {
        throw new ModelStopError("Claude declined to answer that.");
      }
      if (message.stop_reason === "max_tokens") {
        throw cutOffError();
      }
      const toolCalls = message.content.flatMap((block) =>
        block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : [],
      );
      if (toolCalls.length > 0) contentByToolCalls.set(toolCalls, message.content);
      return {
        text: message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(""),
        toolCalls,
        usage: usageOf(model, message.usage),
      };
    },
  };
}

function errorEvent(error: unknown): ProviderEvent {
  if (error instanceof Anthropic.AuthenticationError) {
    return {
      type: "error",
      message: "The Anthropic API rejected ANTHROPIC_API_KEY. Check the key and ask again.",
      retryable: false,
    };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return {
      type: "error",
      message: "The Anthropic API rate limit was reached. Wait a moment and ask again.",
      retryable: true,
    };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      type: "error",
      message: `The Anthropic API failed: ${error.message}`,
      retryable: error.status === undefined || error.status >= 500,
    };
  }
  throw error;
}

export function claudeApi({
  apiKey,
  model = defaultModel,
  client = new Anthropic({ apiKey }),
}: {
  apiKey: string;
  model?: string | undefined;
  client?: MessagesClient;
}): LLMProvider {
  return agentProvider({
    buildModel: (request, tools) => anthropicModel(client, model, request, tools),
    apiError: errorEvent,
  });
}
