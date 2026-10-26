import type { Speaker } from "./speaker.ts";

export function spokenProgress(text: string) {
  return text.replace(/^(Looking at .+)\.[^.\s]+$/, "$1");
}

export function createAnnouncer(speaker: Speaker, onError: (error: Error) => void) {
  let waiting: string[] = [];
  let controller = new AbortController();
  let running: Promise<void> | undefined;

  async function drain() {
    for (let text = waiting.shift(); text !== undefined; text = waiting.shift()) {
      try {
        await speaker.speak(text, controller.signal);
      } catch (error) {
        waiting = [];
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    running = undefined;
  }

  return {
    say(text: string) {
      waiting.push(text);
      running ??= drain();
    },
    dropWaiting() {
      waiting = [];
    },
    stop() {
      waiting = [];
      controller.abort();
      controller = new AbortController();
    },
    finished: () => running ?? Promise.resolve(),
  };
}
