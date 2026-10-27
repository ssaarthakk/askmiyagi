import { z } from "zod";
import { resolvedAnchorSchema } from "./anchor.ts";
import { stepSchema, tourSchema } from "./tour.ts";
import { usageSchema } from "./usage.ts";

const ranges = z.array(resolvedAnchorSchema.nullable());

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step"), step: stepSchema }),
  z.object({ type: z.literal("checkQuestion"), text: z.string().min(1) }),
  z.object({ type: z.literal("tool_call"), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal("done"), usage: usageSchema }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    detail: z.string().optional(),
    retryable: z.boolean(),
  }),
]);

export const askEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack"), text: z.string() }),
  z.object({ type: z.literal("progress"), text: z.string() }),
  z.object({ type: z.literal("step"), step: stepSchema, ranges }),
  z.object({ type: z.literal("tour"), tour: tourSchema, ranges: z.array(ranges) }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);

export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type AskEvent = z.infer<typeof askEventSchema>;
