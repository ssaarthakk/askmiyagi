import { z } from "zod";
import { usageSchema } from "./usage.ts";

const grade = z.number().int().min(1).max(5);

export const gradesSchema = z.strictObject({
  correctness: grade,
  clarity: grade,
  questionQuality: grade,
  intentFit: grade,
});

export const gradeDimensions = gradesSchema.keyof().options;

export type Grades = z.infer<typeof gradesSchema>;

export const failureLabels = ["retrieval-miss", "reasoning-miss"] as const;

const evalRunSchema = z.strictObject({
  checks: z.record(z.string(), z.union([z.boolean(), z.number()])),
  failure: z.enum(failureLabels).optional(),
  grades: gradesSchema.optional(),
  usage: usageSchema,
  durationMs: z.number().nonnegative(),
});

export type CaseRun = z.infer<typeof evalRunSchema>;

export const evalResultSchema = z.strictObject({
  suite: z.string().min(1),
  provider: z.string().min(1),
  runs: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  cases: z.array(z.strictObject({ question: z.string(), runs: z.array(evalRunSchema) })),
});

export type EvalResult = z.infer<typeof evalResultSchema>;
