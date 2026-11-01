import { ackPhrases } from "../shared/phrases.ts";
import { createModelEngine, type ModelEngine } from "./model-download.ts";

export type Speaker = {
  speak(text: string, signal: AbortSignal, onStart?: () => void): Promise<void>;
  prefetch?(text: string): void;
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
  return {
    async speak(text, signal, onStart) {
      const [voice] = await localVoices(synthesis);
      if (!voice) throw new Error(noLocalVoice);
      if (signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
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

function playAudio(audio: Blob, signal: AbortSignal, onStart?: () => void) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(audio);
    const element = new Audio(url);
    const finish = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    element.onended = finish;
    element.onerror = () => {
      URL.revokeObjectURL(url);
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
  const preloaded = new Map<string, Promise<Blob>>();
  const upcoming = new Map<string, Promise<Blob>>();
  function loadInto(store: Map<string, Promise<Blob>>, text: string) {
    const audio = load(text);
    store.set(text, audio);
    audio.catch(() => store.delete(text));
  }
  return {
    preload(texts: string[]) {
      for (const text of texts) loadInto(preloaded, text);
    },
    prefetch(text: string) {
      if (preloaded.has(text) || upcoming.has(text)) return;
      upcoming.clear();
      loadInto(upcoming, text);
    },
    async speak(text: string, signal: AbortSignal, onStart?: () => void) {
      let audio: Blob | undefined;
      try {
        const pending = preloaded.get(text) ?? upcoming.get(text);
        upcoming.delete(text);
        audio = await (pending ? untilAborted(pending, signal) : load(text, signal));
      } catch {
        if (signal.aborted) return;
        onFallback();
        await fallback.speak(text, signal, onStart);
        return;
      }
      if (!audio) return;
      await playAudio(audio, signal, onStart);
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
    (text) => engine.run(text),
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
  return {
    prefetch(text) {
      if (loaded) local.prefetch(text);
    },
    speak(text, signal, onStart) {
      return (loaded ? local : fallback).speak(text, signal, onStart);
    },
  };
}

export function chooseSpeaker(voice: string, token: string, notify: (text: string) => void) {
  const browser = browserSpeaker(speechSynthesis);
  if (voice === "kokoro") {
    const worker = new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" });
    const onProgress = (percent: number) => notify(`Downloading the local voice: ${percent}%`);
    const engine = createModelEngine<string, Blob>(worker, onProgress, "The local voice stopped");
    return kokoroSpeaker(engine, browser, notify);
  }
  if (voice !== "elevenlabs") return browser;
  const elevenLabs = elevenLabsSpeaker(token, browser, () => notify(elevenLabsFailed));
  elevenLabs.preload(ackPhrases);
  return elevenLabs;
}
