import { z } from "zod";

export const transcriptSchema = z.object({ text: z.string() });
