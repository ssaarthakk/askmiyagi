import { neighbour, type PlayerStep, type Position } from "./player.ts";
import { noLocalVoice, type Speaker } from "./speaker.ts";

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

  function segmentAt(position: Position) {
    return hooks.steps()[position.step]?.step.narration[position.segment];
  }

  async function play(from: Position | undefined) {
    running?.abort();
    const mine = new AbortController();
    running = mine;
    current = from;
    let spoken = false;
    let failure: unknown;
    async function say(text: string, signal: AbortSignal, onStart: () => void) {
      try {
        await speaker.speak(text, signal, onStart);
        spoken = true;
      } catch (error) {
        if (error instanceof Error && error.message === noLocalVoice) throw error;
        failure = error;
        console.warn("Skipped a narration part that could not be spoken", error);
      }
    }
    try {
      await hooks.ready();
      if (mine.signal.aborted) return;
      let at: Position | undefined = from;
      while (at) {
        const segment = segmentAt(at);
        if (!segment) break;
        const started = at;
        current = at;
        await say(segment.text, mine.signal, () => {
          if (mine.signal.aborted) return;
          hooks.onStart(started);
          const after = neighbour(hooks.steps(), started, 1);
          const upcoming = after ? segmentAt(after)?.text : hooks.closing();
          if (upcoming) speaker.prefetch?.(upcoming);
        });
        if (mine.signal.aborted) return;
        at = neighbour(hooks.steps(), at, 1);
      }
      const closing = hooks.closing();
      if (closing) {
        await say(closing, mine.signal, () => undefined);
        if (mine.signal.aborted) return;
      }
      if (!spoken && failure) throw failure;
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
