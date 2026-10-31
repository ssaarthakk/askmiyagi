import { resolve } from "node:path";
import { vi } from "vitest";
import type { LLMProvider } from "../src/server/llm/provider.ts";
import type { ProviderEvent } from "../src/shared/events.ts";
import type { LLMRequest } from "../src/shared/llm-request.ts";
import type { Step } from "../src/shared/tour.ts";

export const root = resolve(import.meta.dirname, "fixtures/basic");

export const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

export const saveStep: Step = {
  title: "Saving a clip",
  anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
  narration: [{ text: "Clips are saved here.", anchor: 0 }],
};

export function terminal() {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return () => write.mock.calls.map(([text]) => String(text)).join("");
}

export function scripted(events: ProviderEvent[], seen: LLMRequest[] = []): LLMProvider {
  return {
    async *ask(request) {
      seen.push(request);
      yield* events;
    },
  };
}
