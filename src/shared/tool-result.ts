import { z } from "zod";

export const toolResultSchema = z.object({ text: z.string(), isError: z.boolean() });

export type ToolResult = z.infer<typeof toolResultSchema>;
