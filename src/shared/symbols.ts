import { z } from "zod";

export const symbolsSchema = z.object({ symbols: z.array(z.string()) });
