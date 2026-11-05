import { z } from "zod";
import { usageSchema } from "./usage.ts";

const milliseconds = z.number().nonnegative();

export const callRecordSchema = usageSchema.extend({
  callType: z.enum(["ask", "summary", "rubric", "prediction", "grade", "path"]),
  provider: z.string().min(1),
  mode: z.enum(["brute-force", "agentic"]).nullable(),
  startedAt: z.iso.datetime(),
  ackMs: milliseconds,
  firstContentMs: milliseconds.nullable(),
  filesOpened: z.array(z.string()),
  outcome: z.enum(["done", "error", "aborted"]),
  firstSoundMs: milliseconds.optional(),
});

export const firstSoundSchema = z.object({ ms: milliseconds });

export type CallRecord = z.infer<typeof callRecordSchema>;
