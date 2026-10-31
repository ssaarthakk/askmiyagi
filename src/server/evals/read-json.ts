import { readFile } from "node:fs/promises";
import type { z } from "zod";
import { parseContract } from "../../shared/parse.ts";
import type { Result } from "../../shared/result.ts";

export async function readJsonFile<T>(
  file: string,
  schema: z.ZodType<T>,
  notFoundLabel: string,
): Promise<Result<T>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return { ok: false, error: `${notFoundLabel} not found: ${file}` };
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: `${file}\nnot valid JSON` };
  }
  const parsed = parseContract(schema, json);
  return parsed.ok ? parsed : { ok: false, error: `${file}\n${parsed.error}` };
}
