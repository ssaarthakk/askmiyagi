export type LineRange = { start: number; end: number };
export type Highlight = { file: string; current: LineRange | null; previous: LineRange | null };

function sameRange(a: LineRange, b: LineRange) {
  return a.start === b.start && a.end === b.end;
}

export function moveHighlight(
  shown: Highlight | undefined,
  file: string,
  range: LineRange | null,
): Highlight {
  const last = shown?.file === file ? shown.current : null;
  const previous = range && last && !sameRange(last, range) ? last : null;
  return { file, current: range, previous };
}
