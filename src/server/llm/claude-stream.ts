import { z } from "zod";
import type { ProviderEvent } from "../../shared/events.ts";
import { parseContract } from "../../shared/parse.ts";
import { stepSchema } from "../../shared/tour.ts";

const toolPrefix = "mcp__miyagi__";
const authenticationFailed = "authentication_failed";
const notLoggedIn = "Claude Code is not logged in. Run `claude` and use /login, then ask again.";
const tokenCount = z.number().int().nonnegative().default(0);

const lineTypeSchema = z.object({ type: z.string() });

const textDeltaSchema = z.object({
  type: z.literal("stream_event"),
  event: z.object({
    type: z.literal("content_block_delta"),
    delta: z.object({ type: z.literal("text_delta"), text: z.string() }),
  }),
});

const assistantSchema = z.object({
  type: z.literal("assistant"),
  error: z.string().optional(),
  message: z.object({
    content: z.array(
      z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() }),
    ),
  }),
});

const resultSchema = z.object({
  type: z.literal("result"),
  is_error: z.boolean().default(false),
  result: z.string().default(""),
  total_cost_usd: z.number().nonnegative().optional(),
  usage: z
    .object({
      input_tokens: tokenCount,
      output_tokens: tokenCount,
      cache_read_input_tokens: tokenCount,
      cache_creation_input_tokens: tokenCount,
    })
    .prefault({}),
});

const checkQuestionSchema = z.object({ checkQuestion: z.string().min(1) });

function failure(message: string): ProviderEvent {
  return { type: "error", message, retryable: false };
}

function parseModelLine(line: string): ProviderEvent {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { type: "text", text: line };
  }
  if (typeof json === "object" && json !== null && "checkQuestion" in json) {
    const parsed = parseContract(checkQuestionSchema, json);
    return parsed.ok
      ? { type: "checkQuestion", text: parsed.value.checkQuestion }
      : failure(parsed.error);
  }
  const parsed = parseContract(stepSchema, json);
  return parsed.ok ? { type: "step", step: parsed.value } : failure(parsed.error);
}

function* modelLineEvents(text: string) {
  const line = text.trim();
  if (line !== "") yield parseModelLine(line);
}

export async function* parseClaudeStream(
  lines: AsyncIterable<string>,
): AsyncGenerator<ProviderEvent> {
  let pending = "";
  let loggedOut = false;
  for await (const raw of lines) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const type = lineTypeSchema.safeParse(json);
    if (!type.success) {
      yield failure("Claude Code produced output Miyagi could not read");
      continue;
    }

    if (type.data.type === "stream_event") {
      const delta = textDeltaSchema.safeParse(json);
      if (!delta.success) continue;
      const parts = (pending + delta.data.event.delta.text).split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) yield* modelLineEvents(part);
    } else if (type.data.type === "assistant") {
      yield* modelLineEvents(pending);
      pending = "";
      const parsed = parseContract(assistantSchema, json);
      if (!parsed.ok) {
        yield failure(parsed.error);
        continue;
      }
      if (parsed.value.error === authenticationFailed) loggedOut = true;
      for (const block of parsed.value.message.content) {
        if (block.type === "tool_use" && block.name !== undefined) {
          yield {
            type: "tool_call",
            name: block.name.startsWith(toolPrefix)
              ? block.name.slice(toolPrefix.length)
              : block.name,
            input: block.input,
          };
        }
      }
    } else if (type.data.type === "result") {
      yield* modelLineEvents(pending);
      pending = "";
      const parsed = parseContract(resultSchema, json);
      if (!parsed.ok) {
        yield failure(parsed.error);
      } else if (parsed.value.is_error) {
        const detail = parsed.value.result === "" ? "" : `: ${parsed.value.result}`;
        yield failure(loggedOut ? notLoggedIn : `Claude Code reported an error${detail}`);
      } else {
        const { usage } = parsed.value;
        yield {
          type: "done",
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheWriteTokens: usage.cache_creation_input_tokens,
            costUsd: parsed.value.total_cost_usd ?? null,
          },
        };
      }
    }
  }
}
