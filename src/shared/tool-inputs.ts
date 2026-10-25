import { z } from "zod";

export const symbolKinds = [
  "function",
  "class",
  "method",
  "variable",
  "interface",
  "type",
] as const;

export const readFileInputSchema = z
  .object({
    path: z.string().min(1),
    start: z.number().int().positive().optional(),
    end: z.number().int().positive().optional(),
    symbol: z.string().min(1).optional(),
  })
  .refine((input) => !(input.symbol && (input.start !== undefined || input.end !== undefined)), {
    message: "symbol cannot be combined with a line range",
  });

export const grepInputSchema = z.object({
  patterns: z.array(z.string().min(1)).min(1),
  caseInsensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  include: z.array(z.string().min(1)).min(1).optional(),
  exclude: z.array(z.string().min(1)).optional(),
});

export const findSymbolInputSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(symbolKinds).optional(),
});
