import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";

export const smallClaudeModel = "claude-haiku-5-5";
export const strongClaudeModel = "claude-opus-5-5";

export const lostThread = "Sorry, I lost my thread there. Please ask again.";

export type LLMProvider = {
  ask(request: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
};
