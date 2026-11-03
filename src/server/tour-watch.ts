import type { Anchor, ResolvedAnchor } from "../shared/anchor.ts";
import type { DiffBase } from "../shared/diff-base.ts";
import type { WatchEvent } from "../shared/events.ts";
import { resolveAnchor } from "./code/anchor-resolver.ts";

type TourStep = { anchors: Anchor[]; ranges: (ResolvedAnchor | null)[] };

function samePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function createTourWatch(options: { root: string; publish: (event: WatchEvent) => void }) {
  let steps: TourStep[] = [];
  let generation = 0;
  let diffBase: DiffBase | undefined;

  return {
    start(base?: DiffBase) {
      generation += 1;
      steps = [];
      diffBase = base;
    },

    addStep(anchors: Anchor[], ranges: (ResolvedAnchor | null)[]) {
      steps.push({ anchors, ranges });
    },

    async changed(paths: string[]) {
      const changed = new Set(paths.map(samePath));
      const tour = [...steps];
      if (!tour.some((step) => step.anchors.some((anchor) => changed.has(samePath(anchor.file))))) {
        return;
      }

      generation += 1;
      const current = generation;
      const resolved = await Promise.all(
        tour.map((step) =>
          Promise.all(
            step.anchors.map(async (anchor) => {
              const result = await resolveAnchor(options.root, anchor, diffBase);
              return result.ok ? result.value : null;
            }),
          ),
        ),
      );
      if (current !== generation) return;

      const lost = new Set<string>();
      tour.forEach((step, index) => {
        step.anchors.forEach((anchor, at) => {
          if (step.ranges[at] && !resolved[index]?.[at]) lost.add(anchor.file);
        });
        step.ranges = resolved[index] ?? step.ranges;
      });
      options.publish({ type: "ranges", ranges: resolved });
      for (const file of lost) options.publish({ type: "stale", file });
    },
  };
}
