import { transcriptSchema } from "../shared/transcript.ts";
import { responseError } from "./response-error.ts";

export async function transcribe(recording: Blob, token: string) {
  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "content-type": recording.type, "x-miyagi-token": token },
    body: recording,
  });
  if (!response.ok) throw await responseError(response, "Speech-to-text");
  return transcriptSchema.parse(await response.json()).text;
}
