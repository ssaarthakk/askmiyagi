import { z } from "zod";
import { usageSchema } from "./usage.ts";

const milliseconds = z.number().nonnegative();

const callRecordSchema = usageSchema.extend({
  callType: z.literal("ask"),
  provider: z.string().min(1),
  mode: z.enum(["brute-force", "agentic"]).nullable(),
  startedAt: z.iso.datetime(),
  ackMs: milliseconds,
  firstContentMs: milliseconds.nullable(),
  filesOpened: z.array(z.string()),
  outcome: z.enum(["done", "error", "aborted"]),
});

export type CallRecord = z.infer<typeof callRecordSchema>;
