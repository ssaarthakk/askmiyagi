import { z } from "zod";

const pathItemSchema = z.object({
  concept: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(500),
  file: z.string().trim().min(1).max(300),
});

export const pathSchema = z.object({ items: z.array(pathItemSchema).min(5).max(10) });

export const pathReplySchema = z
  .object({ items: z.array(pathItemSchema.extend({ done: z.boolean() })) })
  .nullable();

export type PathItem = z.infer<typeof pathItemSchema>;
export type LearningPath = z.infer<typeof pathSchema>;
export type PathReply = z.infer<typeof pathReplySchema>;
export type PathReplyItems = NonNullable<PathReply>["items"];
