import type { Drill } from "../../shared/interview.ts";
import type { Result } from "../../shared/result.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";

export function applyDrill(source: string, edits: Drill["edits"]): Result<string> {
  const placed: { start: number; end: number; replace: string }[] = [];
  for (const { find, replace } of edits) {
    const start = source.indexOf(find);
    if (start === -1) return { ok: false, error: `Drill text not found: ${find}` };
    if (source.indexOf(find, start + 1) !== -1) {
      return { ok: false, error: `Drill text found more than once: ${find}` };
    }
    placed.push({ start, end: start + find.length, replace });
  }
  placed.sort((left, right) => left.start - right.start);
  let result = "";
  let at = 0;
  for (const { start, end, replace } of placed) {
    if (start < at) return { ok: false, error: "Drill edits overlap" };
    result += source.slice(at, start) + replace;
    at = end;
  }
  result += source.slice(at);
  return result === source
    ? { ok: false, error: "Drill edits change nothing" }
    : { ok: true, value: result };
}

export async function drillSource(
  root: string,
  drill: Drill,
): Promise<Result<{ relPath: string; source: string }>> {
  const real = await readRedactedFile(root, drill.file, { withOverlay: false });
  if (!real.ok) return real;
  const drilled = applyDrill(real.value.source, drill.edits);
  if (!drilled.ok) return drilled;
  return { ok: true, value: { relPath: real.value.relPath, source: redact(drilled.value) } };
}
