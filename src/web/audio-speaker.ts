import type { Speaker } from "./speaker.ts";

type Pace = { rate: number; volume: number; element?: HTMLAudioElement };

function playAudio(audio: Blob, signal: AbortSignal, pace: Pace, onStart?: () => void) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(audio);
    const element = new Audio(url);
    element.playbackRate = pace.rate;
    element.volume = pace.volume;
    pace.element = element;
    const release = () => {
      URL.revokeObjectURL(url);
      if (pace.element === element) pace.element = undefined;
    };
    const finish = () => {
      release();
      resolve();
    };
    element.onended = finish;
    element.onerror = () => {
      release();
      reject(new Error("Audio could not be played"));
    };
    signal.addEventListener(
      "abort",
      () => {
        element.pause();
        finish();
      },
      { once: true },
    );
    element.play().then(() => onStart?.(), reject);
  });
}

export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T | undefined>((resolve, reject) => {
    if (signal.aborted) resolve(undefined);
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
    promise.then(resolve, reject);
  });
}

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });

export function sentencesOf(text: string) {
  const parts = Array.from(sentences.segment(text), ({ segment }) => segment.trim());
  const spoken = parts.filter((part) => part !== "");
  return spoken.length > 0 ? spoken : [text];
}

function handled(audio: Promise<Blob>) {
  audio.catch(() => undefined);
  return audio;
}

export function audioSpeaker(
  load: (text: string, signal?: AbortSignal) => Promise<Blob>,
  split: (text: string) => string[],
  fallback: Speaker,
  onFallback: () => void,
) {
  const pace: Pace = { rate: 1, volume: 1 };
  const preloaded = new Map<string, Promise<Blob>>();
  let upcoming: { text: string; audio: Promise<Blob>[]; cancel: AbortController } | undefined;

  function dropUpcoming() {
    upcoming?.cancel.abort();
    upcoming = undefined;
  }

  function clipsFor(text: string, parts: string[], making: AbortSignal) {
    if (upcoming?.text === text) {
      const { audio, cancel } = upcoming;
      upcoming = undefined;
      if (making.aborted) cancel.abort();
      else making.addEventListener("abort", () => cancel.abort(), { once: true });
      return audio;
    }
    dropUpcoming();
    return parts.map((part) => preloaded.get(part) ?? handled(load(part, making)));
  }

  async function playParts(
    text: string,
    signal: AbortSignal,
    making: AbortSignal,
    onStart?: () => void,
  ) {
    const parts = split(text);
    for (const [index, clip] of clipsFor(text, parts, making).entries()) {
      const started = index === 0 ? onStart : undefined;
      let audio: Blob | undefined;
      try {
        audio = await untilAborted(clip, signal);
      } catch {
        if (signal.aborted) return;
        onFallback();
        await fallback.speak(parts.slice(index).join(" "), signal, started);
        return;
      }
      if (!audio) return;
      await playAudio(audio, signal, pace, started);
    }
  }

  return {
    setRate(rate: number) {
      pace.rate = rate;
      if (pace.element) pace.element.playbackRate = rate;
      fallback.setRate?.(rate);
    },
    setVolume(volume: number) {
      pace.volume = volume;
      if (pace.element) pace.element.volume = volume;
    },
    preload(texts: string[]) {
      for (const part of texts.flatMap(split)) {
        const audio = load(part);
        preloaded.set(part, audio);
        audio.catch(() => preloaded.delete(part));
      }
    },
    prefetch(text: string) {
      const parts = split(text);
      if (upcoming?.text === text || parts.every((part) => preloaded.has(part))) return;
      dropUpcoming();
      const cancel = new AbortController();
      const audio = parts.map((part) => preloaded.get(part) ?? load(part, cancel.signal));
      upcoming = { text, audio, cancel };
      for (const clip of audio) {
        clip.catch(() => {
          if (upcoming?.audio === audio) dropUpcoming();
        });
      }
    },
    async speak(text: string, signal: AbortSignal, onStart?: () => void) {
      const finished = new AbortController();
      try {
        await playParts(text, signal, AbortSignal.any([signal, finished.signal]), onStart);
      } finally {
        finished.abort();
      }
    },
  };
}
