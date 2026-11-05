import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { agentTools } from "../tools/definitions.ts";
import type { AgentModel, AgentTool } from "./agent-loop.ts";
import { runAgentLoop } from "./agent-loop.ts";
import { modelLineEvents } from "./claude-stream.ts";
import type { LLMProvider } from "./provider.ts";

export class ModelStopError extends Error {}

export const cutOffError = () =>
  new ModelStopError("The answer was cut off because it was too long. Ask again.");

export function agentProvider({
  buildModel,
  apiError,
}: {
  buildModel(request: LLMRequest, tools: AgentTool[]): AgentModel;
  apiError(error: unknown): ProviderEvent;
}): LLMProvider {
  return {
    async *ask(request, signal) {
      try {
        const tools = request.tools ? agentTools(request.root) : [];
        const loop = runAgentLoop({
          model: buildModel(request, tools),
          tools,
          messages: [...request.history, { role: "user", text: request.question }],
          signal,
          spent: request.spent,
          startedAt: request.startedAt,
        });
        let next = await loop.next();
        while (!next.done) {
          yield next.value;
          next = await loop.next();
        }
        if (signal.aborted) return;
        const { usage, messages } = next.value;
        for (const line of next.value.text.split("\n")) {
          for (const event of modelLineEvents(line, request.plain)) {
            yield event.type === "error" ? { ...event, usage } : event;
          }
        }
        yield { type: "done", usage, messages: messages.slice(request.history.length) };
      } catch (error) {
        if (signal.aborted) return;
        yield error instanceof ModelStopError
          ? { type: "error", message: error.message, retryable: false }
          : apiError(error);
      }
    },
  };
}
