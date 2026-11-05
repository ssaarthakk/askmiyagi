import { z } from "zod";
import { sideSchema } from "./anchor.ts";
import { viewBaseSchema } from "./diff-base.ts";

export const fileResponseSchema = z.object({ path: z.string(), content: z.string() });

export const fileQuerySchema = z
  .object({ path: z.string(), side: sideSchema.optional(), base: viewBaseSchema.optional() })
  .refine((query) => query.side !== "old" || query.base !== undefined, {
    error: "side=old needs a base: uncommitted, branch, snapshot or drill",
  });

export const errorResponseSchema = z.object({ error: z.string() });
