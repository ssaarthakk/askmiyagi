import { z } from "zod";

export const intents = ["interview", "onboarding", "contributing", "debugging"] as const;

export const intentSchema = z.enum(intents);

export type Intent = z.infer<typeof intentSchema>;
