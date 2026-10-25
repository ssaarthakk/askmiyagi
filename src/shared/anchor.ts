import { z } from "zod";

const file = z.string().min(1);
const line = z.number().int().positive();

export const anchorSchema = z.union(
  [
    z.object({ file, symbol: z.string().min(1) }),
    z.object({ file, line, text: z.string().min(1) }),
  ],
  { error: "an anchor is { file, symbol } or { file, line, text }" },
);

export const resolvedAnchorSchema = z.object({
  file,
  start: line,
  end: line,
  capped: z.boolean(),
});

export const selectionSchema = z.object({ file, start: line, end: line, text: z.string() });

export type Anchor = z.infer<typeof anchorSchema>;
export type ResolvedAnchor = z.infer<typeof resolvedAnchorSchema>;
export type Selection = z.infer<typeof selectionSchema>;
