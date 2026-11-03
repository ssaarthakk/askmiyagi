import { z } from "zod";

export const diffBaseSchema = z.enum(["uncommitted", "branch", "snapshot"]);

export const diffRequestSchema = z.object({
  base: diffBaseSchema,
  why: z.string().trim().min(1).max(2000).optional(),
});

export type DiffBase = z.infer<typeof diffBaseSchema>;
export type DiffRequest = z.infer<typeof diffRequestSchema>;
