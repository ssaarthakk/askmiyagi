import type { z } from "zod";
import type { CallRecord } from "../../shared/call-log.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { parseContract } from "../../shared/parse.ts";
import type { Result } from "../../shared/result.ts";
import { addUsage, noUsage } from "../../shared/usage.ts";
import { redact } from "../files/redact.ts";
import type { LLMProvider } from "./provider.ts";

export type CallLog = { provider: string; write(record: CallRecord): Promise<void> };

type ToolsOffCall<T> = {
  callType: Exclude<CallRecord["callType"], "ask">;
  callLog?: CallLog | undefined;
  system: string;
  question: string;
  root: string;
  timeoutMs: number;
  schema: z.ZodType<T>;
  nothingBack: string;
  model?: LLMRequest["model"];
};

export async function askToolsOff<T>(
  provider: LLMProvider,
  call: ToolsOffCall<T>,
): Promise<Result<T>> {
  const request = {
    system: call.system,
    context: "",
    conversation: "",
    history: [],
    question: redact(call.question),
    root: call.root,
    tools: false,
    model: call.model ?? "small",
  };
  const startedAt = new Date();
  let usage = noUsage;
  let outcome: CallRecord["outcome"] = "error";
  const lines: string[] = [];
  try {
    for await (const event of provider.ask(request, AbortSignal.timeout(call.timeoutMs))) {
      if (event.type === "error") {
        if (event.usage) usage = addUsage(usage, event.usage);
        return { ok: false, error: event.detail ?? event.message };
      }
      if (event.type === "done") {
        usage = addUsage(usage, event.usage);
        outcome = "done";
      }
      if (event.type === "text") lines.push(event.text);
    }
  } finally {
    await call.callLog?.write({
      callType: call.callType,
      provider: call.callLog.provider,
      mode: null,
      startedAt: startedAt.toISOString(),
      ackMs: 0,
      firstContentMs: null,
      ...usage,
      filesOpened: [],
      outcome,
    });
  }
  if (lines.length === 0) return { ok: false, error: call.nothingBack };
  return parseContract(call.schema, lines.join(" "));
}
