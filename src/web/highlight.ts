import type { Side } from "../shared/anchor.ts";
import type { DiffBase, ViewBase } from "../shared/diff-base.ts";

export type LineRange = { start: number; end: number; side?: Side | undefined };
export type Highlight = {
  file: string;
  current: LineRange | null;
  previous: LineRange | null;
  base?: ViewBase | undefined;
};

function sameRange(a: LineRange, b: LineRange) {
  return a.start === b.start && a.end === b.end && a.side === b.side;
}

export function moveHighlight(
  shown: Highlight | undefined,
  file: string,
  range: LineRange | null,
  base?: DiffBase,
): Highlight {
  const last = shown?.file === file ? shown.current : null;
  const previous = range && last && !sameRange(last, range) ? last : null;
  return { file, current: range, previous, base };
}
