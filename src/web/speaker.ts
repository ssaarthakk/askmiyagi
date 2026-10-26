import { ackPhrases } from "../shared/phrases.ts";

export type Speaker = {
  speak(text: string, signal: AbortSignal, onStart?: () => void): Promise<void>;
};

export const noLocalVoice = "No local voice found; showing text";
const elevenLabsFailed = "ElevenLabs failed, using the browser voice";

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
        utterance.onstart = () => onStart?.();
        utterance.onend = () => resolve();
        utterance.onerror = (event) => {
          if (signal.aborted) resolve();
          else reject(new Error(`Speech failed: ${event.error}`));
        };
        signal.addEventListener(
          "abort",
          () => {
            synthesis.cancel();
            resolve();
          },
          { once: true },
        );
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

export function elevenLabsSpeaker(token: string, fallback: Speaker, onFallback: () => void) {
  const preloaded = new Map<string, Promise<Blob>>();
  return {
    preload(texts: string[]) {
      for (const text of texts) {
        const audio = fetchSpeech(token, text);
        preloaded.set(text, audio);
        audio.catch(() => preloaded.delete(text));
      }
    },
    async speak(text: string, signal: AbortSignal, onStart?: () => void) {
      let audio: Blob | undefined;
      try {
        const pending = preloaded.get(text);
        audio = await (pending ? untilAborted(pending, signal) : fetchSpeech(token, text, signal));
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

export function chooseSpeaker(voice: string, token: string, notify: (text: string) => void) {
  const browser = browserSpeaker(speechSynthesis);
  if (voice !== "elevenlabs") return browser;
  const elevenLabs = elevenLabsSpeaker(token, browser, () => notify(elevenLabsFailed));
  elevenLabs.preload(ackPhrases);
  return elevenLabs;
}
