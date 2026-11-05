import type { Anchor, ResolvedAnchor } from "../../shared/anchor.ts";
import type { DiffBase } from "../../shared/diff-base.ts";
import type { Current, Tour } from "../../shared/tour.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { readRedactedFile, sourceLines } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";
import { readBaseFile } from "../source/diff-base.ts";

export function highlightedBlock({ file, start, end }: ResolvedAnchor, source: string) {
  const code = sourceLines(source)
    .slice(start - 1, end)
    .map((line, index) => `${start + index}: ${line}`)
    .join("\n");
  return `The highlighted code is lines ${start}-${end} of ${file}:\n${wrapUntrusted("highlighted_code", code)}`;
}

export async function highlightedCode(root: string, anchor: Anchor, base: DiffBase | undefined) {
  const range = await resolveAnchor(root, anchor, base);
  if (!range.ok) return undefined;
  const file =
    range.value.side === "old" && base
      ? await readBaseFile(root, base, range.value.file)
      : await readRedactedFile(root, range.value.file);
  if (!file.ok) return undefined;
  return highlightedBlock(range.value, file.value.source);
}

export async function describePosition(
  root: string,
  tour: Tour,
  current: Current,
  base?: DiffBase,
) {
  const step = tour.steps[current.step];
  const segment = step?.narration[current.segmentIndex];
  if (!step || !segment) return undefined;
  const anchor = step.anchors[segment.anchor ?? 0];
  const code = anchor && (await highlightedCode(root, anchor, base));
  return redact(
    [
      `The learner is looking at step ${current.step + 1} of your tour for "${tour.question}". The step and the narration they have just heard:`,
      wrapUntrusted("tour_position", `${step.title}: ${segment.text}`),
      code,
      'If the message is about this spot (for example "that await" or "why here"), answer about it.',
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
