import { z } from "zod";

const toolCallSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown() });

const toolOutputSchema = z.object({
  callId: z.string(),
  name: z.string(),
  text: z.string(),
  isError: z.boolean(),
});

export const agentMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string() }),
  z.object({ role: z.literal("assistant"), text: z.string(), toolCalls: z.array(toolCallSchema) }),
  z.object({ role: z.literal("tool"), outputs: z.array(toolOutputSchema) }),
]);

export type ToolCall = z.infer<typeof toolCallSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
