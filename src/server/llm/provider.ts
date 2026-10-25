import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";

export type LLMProvider = {
  ask(request: LLMRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
};
