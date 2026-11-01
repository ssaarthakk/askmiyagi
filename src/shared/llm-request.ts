import { z } from "zod";
import { agentMessageSchema } from "./agent-message.ts";
import { usageSchema } from "./usage.ts";

export const llmRequestSchema = z.object({
  system: z.string(),
  context: z.string(),
  conversation: z.string(),
  history: z.array(agentMessageSchema),
  question: z.string(),
  root: z.string(),
  tools: z.boolean(),
  model: z.enum(["strong", "small"]),
  spent: usageSchema.optional(),
  startedAt: z.number().optional(),
});

export type LLMRequest = z.infer<typeof llmRequestSchema>;
