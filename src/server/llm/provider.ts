import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";

export const lostThread = "Sorry, I lost my thread there. Please ask again.";

export type LLMProvider = {
  ask(request: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
};
