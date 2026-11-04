import type { DiffBase } from "../../shared/diff-base.ts";
import type { Tour } from "../../shared/tour.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { highlightedCode } from "./position.ts";

export async function tourContext(root: string, tour: Tour, base?: DiffBase) {
  const steps = await Promise.all(
    tour.steps.map(async (step) => {
      const narration = step.narration.map((part) => part.text).join(" ");
      const code = await Promise.all(
        step.anchors.map((anchor) => highlightedCode(root, anchor, base)),
      );
      return [`${step.title}: ${narration}`, ...code.filter(Boolean)].join("\n");
    }),
  );
  return wrapUntrusted("tour", steps.join("\n\n"));
}
