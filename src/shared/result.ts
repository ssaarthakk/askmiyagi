import { z } from "zod";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function resultSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]);
}
