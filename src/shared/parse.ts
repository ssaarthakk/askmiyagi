import type { z } from "zod";
import type { Result } from "./result.ts";

export function parseContract<T>(schema: z.ZodType<T>, data: unknown): Result<T> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  const problems = parsed.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
  );
  return { ok: false, error: problems.join("\n") };
}
