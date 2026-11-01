import { z } from "zod";

export const sessionSchema = z.object({
  startedAt: z.iso.datetime(),
  summary: z.string().nullable(),
  turns: z.array(z.object({ question: z.string(), record: z.string() })),
});

export type SessionRecord = z.infer<typeof sessionSchema>;
