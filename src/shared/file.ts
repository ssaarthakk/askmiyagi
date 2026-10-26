import { z } from "zod";

export const fileResponseSchema = z.object({ path: z.string(), content: z.string() });

export const errorResponseSchema = z.object({ error: z.string() });
