import { ackPhrases } from "../shared/phrases.ts";
import { createModelEngine, type ModelEngine } from "./model-download.ts";

export type Speaker = {
  speak(text: string, signal: AbortSignal, onStart?: () => void): Promise<void>;
  prefetch?(text: string): void;
  setRate?(rate: number): void;
  setVolume?(volume: number): void;
};

export const noLocalVoice = "No local voice found; showing text";
const elevenLabsFailed = "ElevenLabs failed, using the browser voice";
const kokoroFailed = "Local voice failed, using the browser voice";
const kokoroLoadFailed = "Local voice failed to load, using the browser voice";
const kokoroReady = "Local voice ready";

const voicesWaitMs = 1000;

export async function localVoices(synthesis: SpeechSynthesis) {
  if (synthesis.getVoices().length === 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, voicesWaitMs);
      synthesis.addEventListener(
        "voiceschanged",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return synthesis.getVoices().filter((voice) => voice.localService);
}

export function browserSpeaker(synthesis: SpeechSynthesis): Speaker {
  let rate = 1;
  return {
    setRate(next) {
      rate = next;
    },
    async speak(text, signal, onStart) {
      const [voice] = await localVoices(synthesis);
      if (!voice) throw new Error(noLocalVoice);
      if (signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.rate = rate;
        const stop = () => {
          synthesis.cancel();
          resolve();
        };
        utterance.onstart = () => onStart?.();
        utterance.onend = () => {
          signal.removeEventListener("abort", stop);
          resolve();
        };
        utterance.onerror = (event) => {
          signal.removeEventListener("abort", stop);
          if (signal.aborted || event.error === "interrupted" || event.error === "canceled")
            resolve();
          else reject(new Error(`Speech failed: ${event.error}`));
        };
        signal.addEventListener("abort", stop, { once: true });
        synthesis.speak(utterance);
      });
    },
  };
}

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

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T | undefined>((resolve, reject) => {
    if (signal.aborted) resolve(undefined);
    signal.addEventListener("abort", () => resolve(undefined), { once: true });
    promise.then(resolve, reject);
  });
}

async function fetchSpeech(token: string, text: string, signal?: AbortSignal) {
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) throw new Error(`Speech failed with status ${response.status}`);
  return response.blob();
}

function audioSpeaker(
  load: (text: string, signal?: AbortSignal) => Promise<Blob>,
  fallback: Speaker,
  onFallback: () => void,
) {
  const pace: Pace = { rate: 1, volume: 1 };
  const preloaded = new Map<string, Promise<Blob>>();
  let upcoming: { text: string; audio: Promise<Blob>; cancel: AbortController } | undefined;
  function dropUpcoming() {
    upcoming?.cancel.abort();
    upcoming = undefined;
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
      for (const text of texts) {
        const audio = load(text);
        preloaded.set(text, audio);
        audio.catch(() => preloaded.delete(text));
      }
    },
    prefetch(text: string) {
      if (preloaded.has(text) || upcoming?.text === text) return;
      dropUpcoming();
      const cancel = new AbortController();
      const audio = load(text, cancel.signal);
      upcoming = { text, audio, cancel };
      audio.catch(() => {
        if (upcoming?.audio === audio) upcoming = undefined;
      });
    },
    async speak(text: string, signal: AbortSignal, onStart?: () => void) {
      let audio: Blob | undefined;
      try {
        const next = upcoming?.text === text ? upcoming.audio : undefined;
        if (next) upcoming = undefined;
        else dropUpcoming();
        const pending = preloaded.get(text) ?? next ?? load(text, signal);
        audio = await untilAborted(pending, signal);
      } catch {
        if (signal.aborted) return;
        onFallback();
        await fallback.speak(text, signal, onStart);
        return;
      }
      if (!audio) return;
      await playAudio(audio, signal, pace, onStart);
    },
  };
}

export function elevenLabsSpeaker(token: string, fallback: Speaker, onFallback: () => void) {
  return audioSpeaker((text, signal) => fetchSpeech(token, text, signal), fallback, onFallback);
}

export function kokoroSpeaker(
  engine: ModelEngine<string, Blob>,
  fallback: Speaker,
  notify: (text: string) => void,
): Speaker {
  const local = audioSpeaker(
    (text, signal) => engine.run(text, [], signal),
    fallback,
    () => notify(kokoroFailed),
  );
  let loaded = false;
  engine.ready.then(
    () => {
      loaded = true;
      local.preload(ackPhrases);
      notify(kokoroReady);
    },
    () => notify(kokoroLoadFailed),
  );

  async function speakOnceLoaded(text: string, signal: AbortSignal, onStart?: () => void) {
    try {
      await untilAborted(engine.ready, signal);
    } catch {
      throw new Error(noLocalVoice);
    }
    if (!signal.aborted) await local.speak(text, signal, onStart);
  }

  return {
    setRate: local.setRate,
    setVolume: local.setVolume,
    prefetch(text) {
      if (loaded) local.prefetch(text);
    },
    async speak(text, signal, onStart) {
      if (loaded) return local.speak(text, signal, onStart);
      try {
        await fallback.speak(text, signal, onStart);
      } catch (error) {
        if (!(error instanceof Error && error.message === noLocalVoice)) throw error;
        await speakOnceLoaded(text, signal, onStart);
      }
    },
  };
}

export function chooseSpeaker(
  voice: string,
  token: string,
  notify: (text: string) => void,
  label: (text: string) => void,
) {
  const browser = browserSpeaker(speechSynthesis);
  if (voice === "kokoro") {
    label("Voice: system until Kokoro loads");
    const worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" });
    const onProgress = (percent: number) => {
      notify(`Downloading the local voice: ${percent}%`);
      label(`Voice: system, Kokoro downloading ${percent}%`);
    };
    const engine = createModelEngine<string, Blob>(worker, onProgress, "The local voice stopped");
    engine.ready.then(
      () => label("Voice: Kokoro (local)"),
      () => label("Voice: system, Kokoro failed"),
    );
    return kokoroSpeaker(engine, browser, notify);
  }
  if (voice !== "elevenlabs") {
    label("Voice: system");
    return browser;
  }
  label("Voice by ElevenLabs");
  const elevenLabs = elevenLabsSpeaker(token, browser, () => notify(elevenLabsFailed));
  elevenLabs.preload(ackPhrases);
  return elevenLabs;
}
