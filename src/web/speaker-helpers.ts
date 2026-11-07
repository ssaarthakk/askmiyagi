import { vi } from "vitest";
import type { Speaker } from "./speaker.ts";

export function stubAudio(elements: { playbackRate: number }[] = []) {
  const played: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (audio: Blob) => {
      played.push(audio);
      return "blob:audio";
    },
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      playbackRate = 1;
      volume = 1;
      constructor() {
        elements.push(this);
      }
      play = () => {
        setTimeout(() => this.onended?.());
        return Promise.resolve();
      };
    },
  );
  return played;
}

export function fallbackSpeaker() {
  const spoken: string[] = [];
  const rates: number[] = [];
  const speaker: Speaker = {
    speak: async (text) => {
      spoken.push(text);
    },
    setRate: (rate) => {
      rates.push(rate);
    },
  };
  return { speaker, spoken, rates };
}

export function fakeEngine(ready: Promise<void>) {
  const run = vi.fn(
    async (text: string, _transfer?: Transferable[], _signal?: AbortSignal) =>
      new Blob([`wav:${text}`]),
  );
  return { ready, stopped: false, run };
}

export function signalFor(engine: ReturnType<typeof fakeEngine>, text: string) {
  return engine.run.mock.calls.find(([called]) => called === text)?.[2];
}
