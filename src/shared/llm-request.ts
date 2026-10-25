import { z } from "zod";

export const llmRequestSchema = z.object({
  system: z.string(),
  context: z.string(),
  conversation: z.string(),
  question: z.string(),
  root: z.string(),
  tools: z.boolean(),
  model: z.enum(["strong", "small"]),
});

export type LLMRequest = z.infer<typeof llmRequestSchema>;
