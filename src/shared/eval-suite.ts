import { z } from "zod";

const reference = z.string().regex(/^[^#]+(#[^#]+)?$/, {
  error: "an entry is path or path#Qualified.symbol",
});

const evalCaseSchema = z.strictObject({
  question: z.string().min(1),
  intent: z.string().min(1),
  mustHighlight: z.array(reference),
  expectedOrder: z.array(reference),
  keyFacts: z.array(z.string().min(1)),
});

export const evalSuiteSchema = z.strictObject({
  repo: z.string().min(1),
  cases: z.array(evalCaseSchema).min(1),
});

export type EvalSuite = z.infer<typeof evalSuiteSchema>;
export type EvalCase = EvalSuite["cases"][number];
