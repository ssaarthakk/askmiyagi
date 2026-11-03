import { z } from "zod";
import { sideSchema } from "./anchor.ts";
import { diffBaseSchema } from "./diff-base.ts";

export const fileResponseSchema = z.object({ path: z.string(), content: z.string() });

export const fileQuerySchema = z
  .object({ path: z.string(), side: sideSchema.optional(), base: diffBaseSchema.optional() })
  .refine((query) => query.side !== "old" || query.base !== undefined, {
    error: "side=old needs a base: uncommitted, branch or snapshot",
  });

export const errorResponseSchema = z.object({ error: z.string() });
