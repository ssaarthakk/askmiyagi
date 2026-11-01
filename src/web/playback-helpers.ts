import type { PlayerStep } from "./player.ts";
import type { Speaker } from "./speaker.ts";

export function stepIn(file: string, ...texts: string[]): PlayerStep {
  return {
    step: {
      title: "Step",
      anchors: [{ file, symbol: "A" }],
      narration: texts.map((text) => ({ text, anchor: 0 })),
    },
    ranges: [null],
  };
}

export function oneStep(...texts: string[]) {
  return stepIn("a.ts", ...texts);
}

export const steps = [oneStep("one", "two"), oneStep("three")];

export function controlledSpeaker() {
  const spoken: string[] = [];
  const signals: AbortSignal[] = [];
  const finishers: (() => void)[] = [];
  const failers: ((error: Error) => void)[] = [];
  const speaker: Speaker = {
    speak: (text, signal, onStart) =>
      new Promise<void>((resolve, reject) => {
        onStart?.();
        spoken.push(text);
        signals.push(signal);
        finishers.push(resolve);
        failers.push(reject);
      }),
  };
  return {
    speaker,
    spoken,
    signals,
    finishLast: () => finishers.at(-1)?.(),
    failLast: (error: Error) => failers.at(-1)?.(error),
  };
}
