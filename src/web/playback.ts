import { neighbour, type PlayerStep, type Position } from "./player.ts";
import type { Speaker } from "./speaker.ts";

type PlaybackHooks = {
  steps: () => PlayerStep[];
  ready: () => Promise<void>;
  closing: () => string | undefined;
  onStart: (position: Position) => void;
  onEnd: (error?: Error) => void;
};

export function createPlayback(speaker: Speaker, hooks: PlaybackHooks) {
  let running: AbortController | undefined;
  let current: Position | undefined;

  async function play(from: Position | undefined) {
    running?.abort();
    const mine = new AbortController();
    running = mine;
    current = from;
    try {
      await hooks.ready();
      if (mine.signal.aborted) return;
      let at: Position | undefined = from;
      while (at) {
        const segment = hooks.steps()[at.step]?.step.narration[at.segment];
        if (!segment) break;
        const started = at;
        current = at;
        await speaker.speak(segment.text, mine.signal, () => {
          if (!mine.signal.aborted) hooks.onStart(started);
        });
        if (mine.signal.aborted) return;
        at = neighbour(hooks.steps(), at, 1);
      }
      const closing = hooks.closing();
      if (closing) {
        await speaker.speak(closing, mine.signal, () => undefined);
        if (mine.signal.aborted) return;
      }
      current = undefined;
      hooks.onEnd();
    } catch (error) {
      if (mine.signal.aborted) return;
      current = undefined;
      hooks.onEnd(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function stop() {
    running?.abort();
    const interrupted = current;
    current = undefined;
    return interrupted;
  }

  return { play, stop };
}
