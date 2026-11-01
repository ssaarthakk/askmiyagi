import { transcriptSchema } from "../shared/transcript.ts";
import { withCleanup } from "./cleanup.ts";
import { responseError } from "./response-error.ts";
import { fetchSymbols } from "./symbols.ts";
import type { Transcriber } from "./talk.svelte.ts";
import { createLocalTranscriber, decodeRecording, startWhisper } from "./whisper.ts";

export async function transcribe(recording: Blob, token: string) {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": recording.type, "x-miyagi-token": token },
    body: recording,
  });
  if (!response.ok) throw await responseError(response, "Speech-to-text");
  return transcriptSchema.parse(await response.json()).text;
}

export function chooseTranscriber(elevenLabs: boolean, token: string) {
  const injected = (window as { __MIYAGI_TRANSCRIBER__?: Transcriber }).__MIYAGI_TRANSCRIBER__;
  const speechToText: Transcriber =
    injected ??
    (elevenLabs
      ? (recording) => transcribe(recording, token)
      : createLocalTranscriber(startWhisper, decodeRecording));
  return withCleanup(speechToText, () => fetchSymbols(token));
}
