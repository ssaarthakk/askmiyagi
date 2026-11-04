import { z } from "zod";
import { agentMessageSchema } from "./agent-message.ts";
import { resolvedAnchorSchema } from "./anchor.ts";
import { intentSchema } from "./intent.ts";
import { tourConceptSchema } from "./learner.ts";
import { scopeSchema, stepSchema, tourSchema } from "./tour.ts";
import { usageSchema } from "./usage.ts";

const ranges = z.array(resolvedAnchorSchema.nullable());

export const providerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("step"), step: stepSchema }),
  z.object({
    type: z.literal("checkQuestion"),
    text: z.string().min(1),
    concept: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal("scope"), scope: scopeSchema }),
  z.object({ type: z.literal("intent"), intent: intentSchema }),
  z.object({ type: z.literal("concepts"), concepts: z.array(tourConceptSchema) }),
  z.object({ type: z.literal("tool_call"), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("done"),
    usage: usageSchema,
    messages: z.array(agentMessageSchema).optional(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    detail: z.string().optional(),
    retryable: z.boolean(),
    invalidStep: z.boolean().optional(),
    usage: usageSchema.optional(),
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

export const watchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ranges"), ranges: z.array(ranges) }),
  z.object({ type: z.literal("stale"), file: z.string().min(1) }),
]);

export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type AskEvent = z.infer<typeof askEventSchema>;
export type WatchEvent = z.infer<typeof watchEventSchema>;
