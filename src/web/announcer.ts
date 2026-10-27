import type { Speaker } from "./speaker.ts";

function words(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim();
}

export function spokenProgress(text: string, spokenSoFar: number) {
  if (spokenSoFar >= 2 || text.startsWith("Searching for ")) return undefined;
  const file = text.match(/^Looking at (.+)$/)?.[1];
  const symbol = text.match(/^Finding (.+)$/)?.[1];
  if (file === undefined && symbol === undefined) return text;
  const subject = words(file?.replace(/(?<=.)\.[^.\s]+$/, "") ?? symbol ?? "");
  if (spokenSoFar === 1) return `Now ${subject}.`;
  return `Let me ${file === undefined ? "find" : "look at"} ${subject}.`;
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
