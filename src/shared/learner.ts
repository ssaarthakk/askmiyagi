import { z } from "zod";
import { anchorSchema, resolvedAnchorSchema } from "./anchor.ts";

export const languageConcepts = [
  "async/await",
  "promises",
  "closures",
  "generics",
  "destructuring",
  "spread",
  "optional chaining",
  "classes",
  "modules",
  "error handling",
  "higher-order functions",
  "type narrowing",
] as const;

const conceptKinds = ["repo", "language"] as const;
export const conceptStates = ["seen", "explained", "checked", "reviewed"] as const;

export function sameConcept(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

export function explainBackPrompt(concept: string) {
  return `Explain ${concept} back to me in your own words.`;
}

export const tourConceptSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    important: z.boolean(),
    kind: z.enum(conceptKinds),
  })
  .refine(
    (concept) =>
      concept.kind === "repo" ||
      languageConcepts.some((name) => name === concept.name.toLowerCase()),
    {
      message: `a language concept must be one of: ${languageConcepts.join(", ")}`,
      path: ["name"],
    },
  );

const learnerConceptSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(conceptKinds),
  important: z.boolean(),
  weak: z.boolean().optional(),
  state: z.enum(conceptStates),
  rubric: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  reviewsDone: z.number().int().nonnegative(),
  nextReview: z.iso.datetime().nullable(),
});

export const learnerSchema = z.object({ concepts: z.array(learnerConceptSchema) });

export const tourNameSchema = z.object({ tour: z.string().min(1).max(2000) });

export const conceptNameSchema = z.object({ concept: z.string().trim().min(1).max(100) });

export const explainBackBodySchema = z.object({
  ...conceptNameSchema.shape,
  answer: z.string().trim().min(1).max(2000),
  review: z.boolean().optional(),
});

export const gradeSchema = z.object({
  score: z.number().int().min(1).max(5),
  gaps: z.array(z.string().trim().min(1).max(300)).transform((gaps) => gaps.slice(0, 2)),
  anchors: z.array(anchorSchema).transform((anchors) => anchors.slice(0, 2)),
  modelAnswer: z.string().trim().min(1).max(600),
});

export const explainBackReplySchema = z.object({
  outcome: z.enum(["passed", "retry", "gave-up"]),
  score: z.number().int().min(1).max(5),
  gaps: z.array(z.string()),
  ranges: z.array(resolvedAnchorSchema),
  modelAnswer: z.string().nullable(),
});

export const dueReviewsSchema = z.object({ due: z.array(z.string()) });

export type TourConcept = z.infer<typeof tourConceptSchema>;
export type ConceptState = (typeof conceptStates)[number];
export type Learner = z.infer<typeof learnerSchema>;
export type LearnerConcept = z.infer<typeof learnerConceptSchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type ExplainBackReply = z.infer<typeof explainBackReplySchema>;
