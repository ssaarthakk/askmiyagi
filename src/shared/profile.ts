import { z } from "zod";

export const levels = ["beginner", "intermediate", "advanced"] as const;
export const modes = ["teach", "answer"] as const;
export const frequencies = ["light", "normal", "frequent"] as const;

export const profileSchema = z.object({
  level: z.enum(levels),
  mode: z.enum(modes),
  frequency: z.enum(frequencies),
  goal: z.string().trim().min(1).max(1000).nullable(),
});

export type Profile = z.infer<typeof profileSchema>;

export const defaultProfile: Profile = {
  level: "intermediate",
  mode: "teach",
  frequency: "normal",
  goal: null,
};
