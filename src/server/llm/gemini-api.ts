import {
  ApiError,
  type Content,
  FinishReason,
  FunctionCallingConfigMode,
  type GenerateContentParameters,
  type GenerateContentResponse,
  GoogleGenAI,
} from "@google/genai";
import type { AgentMessage, ToolCall } from "../../shared/agent-message.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Usage } from "../../shared/usage.ts";
import { agentProvider, cutOffError, ModelStopError } from "./agent-events.ts";
import type { AgentModel, AgentTool } from "./agent-loop.ts";
import type { LLMProvider } from "./provider.ts";

type GenerateClient = {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
};

const defaultModel = "gemini-3.8-flash";
const maxOutputTokens = 16000;
const contentByToolCalls = new WeakMap<ToolCall[], Content>();

function usageOf(response: GenerateContentResponse): Usage {
  const metadata = response.usageMetadata;
  const cacheReadTokens = metadata?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: (metadata?.promptTokenCount ?? 0) - cacheReadTokens,
    outputTokens: (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
    cacheReadTokens,
    cacheWriteTokens: 0,
    costUsd: null,
  };
}

function geminiModel(
  client: GenerateClient,
  model: string,
  request: LLMRequest,
  tools: AgentTool[],
): AgentModel {
  const declarations = tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    parametersJsonSchema: inputSchema,
  }));

  function toContent(message: AgentMessage, index: number): Content {
    if (message.role === "assistant") {
      return (
        contentByToolCalls.get(message.toolCalls) ?? {
          role: "model",
          parts: [{ text: message.text }],
        }
      );
    }
    if (message.role === "tool") {
      return {
        role: "user",
        parts: message.outputs.map(({ name, text, isError }) => ({
          functionResponse: { name, response: isError ? { error: text } : { output: text } },
        })),
      };
    }
    const prefix = index === 0 ? [request.context] : [];
    return {
      role: "user",
      parts: [...prefix, message.text].filter((text) => text !== "").map((text) => ({ text })),
    };
  }

  return {
    async step(messages, offered, signal) {
      const response = await client.models.generateContent({
        model,
        contents: messages.map(toContent),
        config: {
          abortSignal: signal,
          maxOutputTokens,
          systemInstruction: request.system,
          ...(declarations.length > 0
            ? {
                tools: [{ functionDeclarations: declarations }],
                toolConfig: {
                  functionCallingConfig: {
                    mode:
                      offered.length > 0
                        ? FunctionCallingConfigMode.AUTO
                        : FunctionCallingConfigMode.NONE,
                  },
                },
              }
            : {}),
        },
      });
      const candidate = response.candidates?.[0];
      if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
        throw cutOffError();
      }
      if (!candidate?.content || candidate.finishReason !== FinishReason.STOP) {
        throw new ModelStopError("Gemini declined to answer that.");
      }
      const parts = candidate.content.parts ?? [];
      const toolCalls = parts.flatMap(({ functionCall }, index) =>
        functionCall?.name
          ? [
              {
                id: functionCall.id ?? `${functionCall.name}-${index}`,
                name: functionCall.name,
                input: functionCall.args ?? {},
              },
            ]
          : [],
      );
      if (toolCalls.length > 0) contentByToolCalls.set(toolCalls, candidate.content);
      return {
        text: parts.flatMap(({ text, thought }) => (text && !thought ? [text] : [])).join(""),
        toolCalls,
        usage: usageOf(response),
      };
    },
  };
}

function errorEvent(error: unknown): ProviderEvent {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return {
        type: "error",
        message: "The Gemini API rate limit was reached. Wait a moment and ask again.",
        retryable: true,
      };
    }
    if (error.status === 401 || error.status === 403 || /api key/i.test(error.message)) {
      return {
        type: "error",
        message: "The Gemini API rejected GEMINI_API_KEY. Check the key and ask again.",
        retryable: false,
      };
    }
    return {
      type: "error",
      message: `The Gemini API failed: ${error.message}`,
      retryable: error.status >= 500,
    };
  }
  throw error;
}

export function geminiApi({
  apiKey,
  model = defaultModel,
  client = new GoogleGenAI({ apiKey }),
}: {
  apiKey: string;
  model?: string | undefined;
  client?: GenerateClient;
}): LLMProvider {
  return agentProvider({
    buildModel: (request, tools) => geminiModel(client, model, request, tools),
    apiError: errorEvent,
  });
}
