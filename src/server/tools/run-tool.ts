import type { z } from "zod";
import type { ToolResult } from "../../shared/tool-result.ts";
import { redact } from "../files/redact.ts";

export function toolResult(text: string, isError = false): ToolResult {
  return { text: redact(text), isError };
}

export async function runTool<Input>(
  root: string,
  name: string,
  schema: z.ZodType<Input>,
  input: unknown,
  run: (input: Input) => Promise<ToolResult>,
): Promise<ToolResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join(", ");
    return toolResult(`Invalid ${name} input: ${reasons}`, true);
  }
  try {
    return await run(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toolResult(message.replaceAll(root, "."), true);
  }
}
