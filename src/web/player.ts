import type { ResolvedAnchor } from "../shared/anchor.ts";
import type { Step } from "../shared/tour.ts";
import type { LineRange } from "./highlight.ts";

export type PlayerStep = { step: Step; ranges: (ResolvedAnchor | null)[] };
export type Position = { step: number; segment: number };

function positions(steps: PlayerStep[]) {
  return steps.flatMap((entry, step) =>
    entry.step.narration.map((_, segment): Position => ({ step, segment })),
  );
}

export function firstPosition(steps: PlayerStep[]) {
  return positions(steps)[0];
}

export function neighbour(steps: PlayerStep[], from: Position, offset: 1 | -1) {
  const all = positions(steps);
  const index = all.findIndex((one) => one.step === from.step && one.segment === from.segment);
  return all[index + offset];
}

export function anchorTarget({ step, ranges }: PlayerStep, segment: number) {
  const index = step.narration[segment]?.anchor ?? 0;
  const anchor = step.anchors[index];
  if (!anchor) return undefined;
  const range: LineRange | null = ranges[index] ?? null;
  return { file: anchor.file, range };
}
