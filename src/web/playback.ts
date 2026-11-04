import { anchorTarget, neighbour, type PlayerStep, type Position } from "./player.ts";
import { noLocalVoice, type Speaker } from "./speaker.ts";

type Interlude = {
  prompt: string;
  reply: Promise<string | undefined>;
};

export type InterludeHook = (
  at: Position,
  when: "before" | "after",
  signal: AbortSignal,
) => Interlude | undefined;

type PlaybackHooks = {
  steps: () => PlayerStep[];
  ready: () => Promise<void>;
  closing: () => string | undefined;
  onLead: (position: Position) => void;
  onStart: (position: Position) => void;
  onEnd: (error?: Error) => void;
  interlude?: InterludeHook | undefined;
};

const scrollLeadMs = 200;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function createPlayback(speaker: Speaker, hooks: PlaybackHooks) {
  let running: AbortController | undefined;
  let current: Position | undefined;

  function segmentAt(position: Position) {
    return hooks.steps()[position.step]?.step.narration[position.segment];
  }

  function fileAt(position: Position) {
    const entry = hooks.steps()[position.step];
    return entry && anchorTarget(entry, position.segment)?.file;
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
    async function interlude(at: Position, when: "before" | "after", signal: AbortSignal) {
      const turn = hooks.interlude?.(at, when, signal);
      if (!turn) return;
      await say(turn.prompt, signal, () => undefined);
      if (signal.aborted) return;
      const feedback = await turn.reply;
      if (signal.aborted || !feedback) return;
      await say(feedback, signal, () => undefined);
    }
    try {
      await hooks.ready();
      if (mine.signal.aborted) return;
      let at: Position | undefined = from;
      let previous: Position | undefined;
      while (at) {
        const segment = segmentAt(at);
        if (!segment) break;
        const started = at;
        current = at;
        const file = fileAt(at);
        if (previous && file && file !== fileAt(previous)) {
          hooks.onLead(at);
          await wait(scrollLeadMs, mine.signal);
          if (mine.signal.aborted) return;
        }
        if (at.segment === 0) {
          await interlude(at, "before", mine.signal);
          if (mine.signal.aborted) return;
        }
        await say(segment.text, mine.signal, () => {
          if (mine.signal.aborted) return;
          hooks.onStart(started);
          const after = neighbour(hooks.steps(), started, 1);
          const upcoming = after ? segmentAt(after)?.text : hooks.closing();
          if (upcoming) speaker.prefetch?.(upcoming);
        });
        if (mine.signal.aborted) return;
        previous = at;
        if (neighbour(hooks.steps(), at, 1)?.step !== at.step) {
          await interlude(at, "after", mine.signal);
          if (mine.signal.aborted) return;
        }
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
