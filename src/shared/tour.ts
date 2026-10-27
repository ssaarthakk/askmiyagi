import { z } from "zod";
import { anchorSchema } from "./anchor.ts";

export const stepSchema = z
  .object({
    title: z.string().min(1),
    anchors: z.array(anchorSchema).min(1).max(3),
    narration: z.array(
      z.object({ text: z.string().min(1), anchor: z.number().int().nonnegative().optional() }),
    ),
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

export const tourSchema = z.object({
  question: z.string(),
  steps: z.array(stepSchema),
  checkQuestion: z.string().min(1).optional(),
  reply: z.string().min(1).optional(),
});

export type Step = z.infer<typeof stepSchema>;
export type Tour = z.infer<typeof tourSchema>;
