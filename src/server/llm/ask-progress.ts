import { basename } from "node:path";
import { z } from "zod";
import {
  findSymbolInputSchema,
  gitInputSchema,
  grepInputSchema,
  readFileInputSchema,
} from "../../shared/tool-inputs.ts";
import type { Step } from "../../shared/tour.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";

export const openedFileSchema = z.object({ path: readFileInputSchema.shape.path });

export function progressText(name: string, input: unknown) {
  if (name === "read_file") {
    const parsed = readFileInputSchema.safeParse(input);
    return parsed.success ? `Looking at ${basename(parsed.data.path)}` : undefined;
  }
  if (name === "grep") {
    const parsed = grepInputSchema.safeParse(input);
    return parsed.success ? `Searching for ${parsed.data.patterns.join(" or ")}` : undefined;
  }
  if (name === "find_symbol") {
    const parsed = findSymbolInputSchema.safeParse(input);
    return parsed.success ? `Finding ${parsed.data.name}` : undefined;
  }
  if (name === "git") {
    return gitInputSchema.safeParse(input).success ? "Looking at the changes" : undefined;
  }
  return undefined;
}

export function retryQuestion(question: string, steps: Step[], errors: string) {
  const sent = steps.map((step) => JSON.stringify(step)).join("\n");
  return redact(`${question}

Your answer so far was accepted and shown to the learner up to step ${steps.length}:
${wrapUntrusted("steps_sent", sent)}
Step ${steps.length + 1} was invalid:
${wrapUntrusted("validation_errors", errors)}
Re-emit from step ${steps.length + 1} onward as NDJSON, fixing those errors. Do not repeat the earlier steps.`);
}
