import { type Detection, type Detector, encodeWav } from "./hands-free.ts";
import { startRecording } from "./recorder.ts";

const microphoneUnavailable = "Microphone unavailable. Type your question instead.";
const microphoneErrors = ["NotAllowedError", "NotFoundError", "NotReadableError"];

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type Transcriber = (recording: Blob, notify: (text: string) => void) => Promise<string>;

export function createTalk(options: {
  transcribe: Transcriber;
  button: () => HTMLButtonElement | undefined;
  onstart: () => void;
  ontranscript: (text: string) => Promise<void>;
  detect: (detection: Detection) => Promise<Detector>;
  duck: (lowered: boolean) => void;
}) {
  let recording = $state(false);
  let notice = $state("");
  let handsFree = $state<"off" | "starting" | "listening">("off");
  let activeRecording: ReturnType<typeof startRecording> | undefined;
  let opened = false;
  let transcribing = false;
  let detector: Promise<Detector> | undefined;
  let overlapsPushToTalk = false;

  function start() {
    if (recording || transcribing) return;
    recording = true;
    overlapsPushToTalk = true;
    opened = false;
    notice = "";
    options.onstart();
    activeRecording = startRecording();
    activeRecording.then(
      () => {
        opened = true;
      },
      () => {
        recording = false;
        notice = microphoneUnavailable;
      },
    );
  }

  async function handle(text: string) {
    try {
      await options.ontranscript(text);
    } catch (error) {
      notice = errorText(error);
    }
  }

  async function stop() {
    if (!recording) return;
    recording = false;
    const heldOpen = opened;
    transcribing = true;
    let text = "";
    try {
      const session = await activeRecording?.catch(() => undefined);
      if (!session) return;
      const audio = await session.stop();
      if (!heldOpen) {
        notice = "Hold the button while you speak";
        return;
      }
      notice = "Transcribing...";
      text = audio.size > 0 ? await options.transcribe(audio, (text) => (notice = text)) : "";
      notice = text ? "" : "Didn't catch that";
    } catch (error) {
      notice = errorText(error);
    } finally {
      transcribing = false;
    }
    if (text) await handle(text);
  }

  async function heard(audio: Float32Array) {
    if (overlapsPushToTalk || transcribing || handsFree === "off") {
      options.duck(false);
      return;
    }
    transcribing = true;
    let text = "";
    try {
      text = await options.transcribe(encodeWav(audio), (text) => (notice = text));
      notice = "";
    } catch (error) {
      notice = errorText(error);
    } finally {
      transcribing = false;
    }
    if (text) options.onstart();
    options.duck(false);
    if (text) await handle(text);
  }

  const detection: Detection = {
    onSpeechStart: () => {
      overlapsPushToTalk = recording;
      if (!overlapsPushToTalk) options.duck(true);
    },
    onVADMisfire: () => options.duck(false),
    onSpeechEnd: (audio) => void heard(audio),
  };

  async function startHandsFree() {
    handsFree = "starting";
    notice = "";
    try {
      if (detector) {
        await (await detector).start();
      } else {
        detector = options.detect(detection);
        await detector;
      }
      if (handsFree === "starting") handsFree = "listening";
    } catch (error) {
      detector = undefined;
      handsFree = "off";
      notice =
        error instanceof DOMException && microphoneErrors.includes(error.name)
          ? microphoneUnavailable
          : `Hands-free failed to start: ${errorText(error)}`;
    }
  }

  async function stopHandsFree() {
    handsFree = "off";
    options.duck(false);
    const running = await detector?.catch(() => undefined);
    if (handsFree === "off") await running?.pause();
  }

  let clicked: Element | null | undefined;

  function spaceTalks(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (event.code !== "Space") return false;
    if (target === options.button()) return true;
    if (target.closest("input, textarea, select, [contenteditable]")) return false;
    const control = target.closest("button, a");
    return !control || control === clicked;
  }

  return {
    get recording() {
      return recording;
    },
    get notice() {
      return notice;
    },
    get handsFree() {
      return handsFree;
    },
    toggleHandsFree() {
      return handsFree === "off" ? startHandsFree() : stopHandsFree();
    },
    stop,
    pointerused(event: PointerEvent) {
      clicked = (event.target as Element).closest("button, a");
    },
    keydown(event: KeyboardEvent) {
      if (event.key === "Tab") clicked = undefined;
      if (!spaceTalks(event)) return;
      event.preventDefault();
      if (!event.repeat) start();
    },
    keyup(event: KeyboardEvent) {
      if (!spaceTalks(event)) return;
      event.preventDefault();
      void stop();
    },
    pointerdown(event: PointerEvent) {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      start();
    },
  };
}
