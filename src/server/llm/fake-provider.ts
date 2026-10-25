import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type ProviderEvent, providerEventSchema } from "../../shared/events.ts";
import { parseContract } from "../../shared/parse.ts";
import type { Result } from "../../shared/result.ts";
import type { LLMProvider } from "./provider.ts";

type RecordedEvent = { event: ProviderEvent; delayMs: number };

const delaySchema = z.object({ delayMs: z.number().int().nonnegative().optional() });

function parseLine(line: string, lineNumber: number): Result<RecordedEvent> {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { ok: false, error: `line ${lineNumber}: not valid JSON` };
  }
  const event = parseContract(providerEventSchema, json);
  const delay = parseContract(delaySchema, json);
  if (!event.ok) return { ok: false, error: prefixLines(lineNumber, event.error) };
  if (!delay.ok) return { ok: false, error: prefixLines(lineNumber, delay.error) };
  return { ok: true, value: { event: event.value, delayMs: delay.value.delayMs ?? 0 } };
}

function prefixLines(lineNumber: number, problems: string) {
  return problems
    .split("\n")
    .map((problem) => `line ${lineNumber}: ${problem}`)
    .join("\n");
}

export async function loadFakeProvider(file: string): Promise<Result<LLMProvider>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { ok: false, error: `Recording not found: ${file}` };
    }
    throw error;
  }

  const recorded: RecordedEvent[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    const parsed = parseLine(line, index + 1);
    if (parsed.ok) recorded.push(parsed.value);
    else problems.push(parsed.error);
  });
  if (problems.length > 0) return { ok: false, error: `${file}\n${problems.join("\n")}` };

  return {
    ok: true,
    value: {
      async *ask(_request, signal) {
        for (const { event, delayMs } of recorded) {
          if (delayMs > 0) {
            try {
              await sleep(delayMs, undefined, { signal });
            } catch {
              return;
            }
          }
          if (signal.aborted) return;
          yield event;
        }
      },
    },
  };
}
