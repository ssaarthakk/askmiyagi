import { z } from "zod";
import { anchorSchema } from "./anchor.ts";
import { intentSchema } from "./intent.ts";
import { tourConceptSchema } from "./learner.ts";

export const primmSchema = z.object({
  predict: z.string().min(1),
  investigate: z.string().min(1),
  target: anchorSchema,
});

export const stepSchema = z
  .object({
    title: z.string().min(1),
    anchors: z.array(anchorSchema).min(1).max(3),
    narration: z.array(
      z.object({ text: z.string().min(1), anchor: z.number().int().nonnegative().optional() }),
    ),
    primm: primmSchema.optional(),
  })
  .superRefine((step, context) => {
    step.narration.forEach((part, index) => {
      if (part.anchor !== undefined && part.anchor >= step.anchors.length) {
        context.addIssue({
          code: "custom",
          message: `must be an index into the ${step.anchors.length} anchors`,
          path: ["narration", index, "anchor"],
        });
      }
    });
  });

export const scopeSchema = z.enum(["side", "new"]);

export const currentSchema = z.object({
  tour: z.string().min(1).max(2000),
  step: z.number().int().nonnegative(),
  segmentIndex: z.number().int().nonnegative(),
});

export const tourSchema = z.object({
  question: z.string(),
  steps: z.array(stepSchema),
  checkQuestion: z.string().min(1).optional(),
  checkConcept: z.string().min(1).optional(),
  reply: z.string().min(1).optional(),
  scope: scopeSchema.optional(),
  intent: intentSchema.optional(),
  concepts: z.array(tourConceptSchema).optional(),
});

export function stepAnchors(step: Step) {
  return step.primm ? [...step.anchors, step.primm.target] : step.anchors;
}

export function anchorRanges<T>(steps: Step[], ranges: T[][]) {
  return ranges.map((stepRanges, index) => stepRanges.slice(0, steps[index]?.anchors.length));
}

export type Step = z.infer<typeof stepSchema>;
export type Tour = z.infer<typeof tourSchema>;
export type Current = z.infer<typeof currentSchema>;
