import type { Selection } from "../../shared/anchor.ts";
import type { Result } from "../../shared/result.ts";
import { readRedactedFile, sourceLines } from "../files/path-guard.ts";

export async function checkSelection(root: string, selection: Selection): Promise<Result<null>> {
  const file = await readRedactedFile(root, selection.file);
  if (!file.ok) return { ok: false, error: `${selection.file}: ${file.error}` };
  const lines = sourceLines(file.value.source);
  if (selection.end < selection.start || selection.end > lines.length) {
    return {
      ok: false,
      error: `${selection.file} has no lines ${selection.start}-${selection.end}`,
    };
  }
  const selected = `${lines.slice(selection.start - 1, selection.end).join("\n")}\n`;
  if (!selected.includes(selection.text.replaceAll("\r\n", "\n"))) {
    return {
      ok: false,
      error: `lines ${selection.start}-${selection.end} of ${selection.file} do not contain the selected text`,
    };
  }
  return { ok: true, value: null };
}
