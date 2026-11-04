import type { z } from "zod";
import { parseContract } from "../../shared/parse.ts";
import type { Result } from "../../shared/result.ts";
import { redact } from "../files/redact.ts";
import type { LLMProvider } from "./provider.ts";

type SmallCall<T> = {
  system: string;
  question: string;
  root: string;
  timeoutMs: number;
  schema: z.ZodType<T>;
  nothingBack: string;
};

export async function askSmall<T>(provider: LLMProvider, call: SmallCall<T>): Promise<Result<T>> {
  const request = {
    system: call.system,
    context: "",
    conversation: "",
    history: [],
    question: redact(call.question),
    root: call.root,
    tools: false,
    model: "small" as const,
  };
  const lines: string[] = [];
  for await (const event of provider.ask(request, AbortSignal.timeout(call.timeoutMs))) {
    if (event.type === "error") return { ok: false, error: event.detail ?? event.message };
    if (event.type === "text") lines.push(event.text);
  }
  if (lines.length === 0) return { ok: false, error: call.nothingBack };
  return parseContract(call.schema, lines.join(" "));
}
