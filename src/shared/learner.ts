import { z } from "zod";

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
  state: z.enum(conceptStates),
  rubric: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  reviewsDone: z.number().int().nonnegative(),
  nextReview: z.iso.datetime().nullable(),
});

export const learnerSchema = z.object({ concepts: z.array(learnerConceptSchema) });

export const playedSchema = z.object({ tour: z.string().min(1).max(2000) });

export type TourConcept = z.infer<typeof tourConceptSchema>;
export type ConceptState = (typeof conceptStates)[number];
export type Learner = z.infer<typeof learnerSchema>;
