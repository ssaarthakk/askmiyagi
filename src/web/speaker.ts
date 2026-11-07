import { ackPhrases } from "../shared/phrases.ts";
import { audioSpeaker, sentencesOf, untilAborted } from "./audio-speaker.ts";
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

export function elevenLabsSpeaker(token: string, fallback: Speaker, onFallback: () => void) {
  return audioSpeaker(
    (text, signal) => fetchSpeech(token, text, signal),
    (text) => [text],
    fallback,
    onFallback,
  );
}

export function localSpeaker(
  engine: ModelEngine<string, Blob>,
  fallback: Speaker,
  notify: (text: string) => void,
): Speaker {
  const local = audioSpeaker(
    (text, signal) => engine.run(text, [], signal),
    sentencesOf,
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

const localModels: Record<string, { name: string; worker: () => Worker }> = {
  kokoro: {
    name: "Kokoro",
    worker: () => new Worker(new URL("./kokoro-worker.ts", import.meta.url), { type: "module" }),
  },
  chatterbox: {
    name: "Chatterbox",
    worker: () =>
      new Worker(new URL("./chatterbox-worker.ts", import.meta.url), { type: "module" }),
  },
};

export function chooseSpeaker(
  voice: string,
  token: string,
  notify: (text: string) => void,
  label: (text: string) => void,
) {
  const browser = browserSpeaker(speechSynthesis);
  const local = localModels[voice];
  if (local) {
    label(`Voice: system until ${local.name} loads`);
    const onProgress = (percent: number) => {
      notify(`Downloading the local voice: ${percent}%`);
      label(`Voice: system, ${local.name} downloading ${percent}%`);
    };
    const engine = createModelEngine<string, Blob>(
      local.worker(),
      onProgress,
      "The local voice stopped",
    );
    engine.ready.then(
      () => label(`Voice: ${local.name} (local)`),
      () => label(`Voice: system, ${local.name} failed`),
    );
    return localSpeaker(engine, browser, notify);
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
