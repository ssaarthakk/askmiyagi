import { startRecording } from "./recorder.ts";
import { transcribe } from "./transcribe.ts";

const microphoneUnavailable = "Microphone unavailable. Type your question instead.";

export function createTalk(options: {
  enabled: boolean;
  token: string;
  busy: () => boolean;
  button: () => HTMLButtonElement | undefined;
  onstart: () => void;
  onquestion: (text: string) => Promise<void>;
}) {
  let recording = $state(false);
  let notice = $state("");
  let activeRecording: ReturnType<typeof startRecording> | undefined;
  let opened = false;
  let transcribing = false;

  function start() {
    if (!options.enabled || recording || transcribing || options.busy()) return;
    recording = true;
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

  async function stop() {
    if (!recording) return;
    recording = false;
    const heldOpen = opened;
    transcribing = true;
    try {
      const session = await activeRecording?.catch(() => undefined);
      if (!session) return;
      const audio = await session.stop();
      if (!heldOpen) {
        notice = "Hold the button while you speak";
        return;
      }
      notice = "Transcribing...";
      const text = audio.size > 0 ? await transcribe(audio, options.token) : "";
      notice = text ? "" : "Didn't catch that";
      if (text) await options.onquestion(text);
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      transcribing = false;
    }
  }

  let clicked: Element | null | undefined;

  function spaceTalks(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (!options.enabled || event.code !== "Space") return false;
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
