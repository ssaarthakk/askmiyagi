import { ClaudeProcessError, runClaude } from "./claude-process.ts";
import { parseClaudeStream } from "./claude-stream.ts";
import type { LLMProvider } from "./provider.ts";

export const claudeHeadless: LLMProvider = {
  async *ask(request, signal) {
    try {
      yield* parseClaudeStream(runClaude(request, signal));
    } catch (error) {
      if (!(error instanceof ClaudeProcessError)) throw error;
      yield { type: "error", message: error.message, retryable: error.retryable };
    }
  },
};
