import { vi } from "vitest";
import type { Speaker } from "./speaker.ts";

export function stubAudio() {
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
  const speaker: Speaker = {
    speak: async (text) => {
      spoken.push(text);
    },
  };
  return { speaker, spoken };
}
