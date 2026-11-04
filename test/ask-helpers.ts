import { resolve } from "node:path";
import { vi } from "vitest";
import { askEvents } from "../src/server/llm/ask.ts";
import { createConversation } from "../src/server/llm/conversation.ts";
import { type LLMProvider, lostThread } from "../src/server/llm/provider.ts";
import { createQuestionPolicy, type QuestionPolicy } from "../src/server/teach/question-policy.ts";
import type { ProviderEvent } from "../src/shared/events.ts";
import type { TourConcept } from "../src/shared/learner.ts";
import type { LLMRequest } from "../src/shared/llm-request.ts";
import { defaultProfile, type Profile } from "../src/shared/profile.ts";
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

export const retryConcept: TourConcept = {
  name: "upload retries",
  important: true,
  kind: "repo",
};

export const checkEvents: ProviderEvent[] = [
  { type: "checkQuestion", text: "What does save return?", concept: retryConcept.name },
  { type: "concepts", concepts: [retryConcept] },
];

export function questionOptions(
  options: {
    frequency?: Profile["frequency"];
    mode?: Profile["mode"];
    policy?: QuestionPolicy;
    checked?: string[];
  } = {},
) {
  return {
    questionPolicy: options.policy ?? createQuestionPolicy(),
    loadProfile: async () => ({
      ...defaultProfile,
      frequency: options.frequency ?? "frequent",
      mode: options.mode ?? "teach",
    }),
    checkedConcepts: async () => options.checked ?? [],
  };
}

export function stream(
  provider: LLMProvider,
  signal = new AbortController().signal,
  conversation = createConversation(),
  extra: Partial<Parameters<typeof askEvents>[0]> = {},
) {
  return askEvents({
    root,
    provider,
    question: "How are clips saved?",
    ack: "One moment.",
    signal,
    conversation,
    ...extra,
  });
}
