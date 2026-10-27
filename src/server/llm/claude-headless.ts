import { ClaudeProcessError, runClaude } from "./claude-process.ts";
import { parseClaudeStream } from "./claude-stream.ts";
import type { LLMProvider } from "./provider.ts";

export function claudeHeadless(model?: string): LLMProvider {
  return {
    async *ask(request, signal) {
      try {
        yield* parseClaudeStream(runClaude(request, signal, { model }));
      } catch (error) {
        if (!(error instanceof ClaudeProcessError)) throw error;
        yield { type: "error", message: error.message, retryable: error.retryable };
      }
    },
  };
}
