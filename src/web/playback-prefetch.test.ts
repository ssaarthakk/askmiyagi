import { describe, expect, it, vi } from "vitest";
import { createPlayback } from "./playback.ts";
import type { PlayerStep } from "./player.ts";
import type { Speaker } from "./speaker.ts";

const steps: PlayerStep[] = [
  {
    step: {
      title: "Step",
      anchors: [{ file: "a.ts", symbol: "A" }],
      narration: [{ text: "one" }, { text: "two" }],
    },
    ranges: [null],
  },
];

describe("playback prefetch", () => {
  it("asks the speaker to fetch the next sentence, then the closing line, while one plays", async () => {
    const prefetched: string[] = [];
    const finishers: (() => void)[] = [];
    const speaker: Speaker = {
      speak: (_text, _signal, onStart) =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
          onStart?.();
        }),
      prefetch: (text) => prefetched.push(text),
    };
    const playback = createPlayback(speaker, {
      steps: () => steps,
      ready: () => Promise.resolve(),
      closing: () => "What does A return?",
      onStart: vi.fn(),
      onEnd: vi.fn(),
    });

    void playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(finishers).toHaveLength(1));
    expect(prefetched).toEqual(["two"]);

    finishers[0]?.();
    await vi.waitFor(() => expect(finishers).toHaveLength(2));
    expect(prefetched).toEqual(["two", "What does A return?"]);
  });
});
