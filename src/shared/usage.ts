import { z } from "zod";

const tokenCount = z.number().int().nonnegative();

export const usageSchema = z.object({
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
  cacheWriteTokens: tokenCount,
  costUsd: z.number().nonnegative().nullable(),
});

export type Usage = z.infer<typeof usageSchema>;
