import { resolve } from "node:path";
import { vi } from "vitest";
import { askEvents } from "../src/server/llm/ask.ts";
import { createConversation } from "../src/server/llm/conversation.ts";
import { type LLMProvider, lostThread } from "../src/server/llm/provider.ts";
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

export const uploadStep: Step = {
  title: "Uploading",
  anchors: [
    { file: "src/upload.ts", symbol: "uploadClip" },
    { file: "src/missing.ts", symbol: "nothing" },
  ],
  narration: [{ text: "Then the clip is uploaded." }],
};

export const invalidStep: ProviderEvent = {
  type: "error",
  message: lostThread,
  detail: "title: must not be empty",
  retryable: false,
  invalidStep: true,
};

export function attempts(scripts: ProviderEvent[][], seen: LLMRequest[] = []): LLMProvider {
  return {
    async *ask(request) {
      seen.push(request);
      yield* scripts[seen.length - 1] ?? [];
    },
  };
}

export function stream(
  provider: LLMProvider,
  signal = new AbortController().signal,
  conversation = createConversation(),
) {
  return askEvents({
    root,
    provider,
    question: "How are clips saved?",
    ack: "One moment.",
    signal,
    conversation,
  });
}
