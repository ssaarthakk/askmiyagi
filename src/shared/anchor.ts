import { z } from "zod";

const file = z.string().min(1);
const line = z.number().int().positive();

export const sideSchema = z.enum(["old", "new"]);

export const anchorSchema = z.union(
  [
    z.object({ file, symbol: z.string().min(1), side: sideSchema.optional() }),
    z.object({ file, line, text: z.string().min(1), side: sideSchema.optional() }),
  ],
  { error: "an anchor is { file, symbol } or { file, line, text }" },
);

export type Side = z.infer<typeof sideSchema>;

export const resolvedAnchorSchema = z.object({
  file,
  start: line,
  end: line,
  capped: z.boolean(),
  side: sideSchema.optional(),
});

export const selectionSchema = z.object({ file, start: line, end: line, text: z.string() });

export type Anchor = z.infer<typeof anchorSchema>;
export type ResolvedAnchor = z.infer<typeof resolvedAnchorSchema>;
export type Selection = z.infer<typeof selectionSchema>;
