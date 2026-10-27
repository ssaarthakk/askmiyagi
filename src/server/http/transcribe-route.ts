import type { IncomingMessage, ServerResponse } from "node:http";
import { transcriptSchema } from "../../shared/transcript.ts";
import { readBody, sendError } from "./ask-route.ts";

const maxRecordingBytes = 10 * 1024 * 1024;
const timeoutMs = 30_000;
const audioTypes = ["audio/webm", "audio/ogg"];

export function createTranscribeHandler(options: { apiKey?: string | undefined }) {
  return async function handleTranscribe(request: IncomingMessage, response: ServerResponse) {
    if (!options.apiKey) {
      sendError(response, 404, "Not found");
      return;
    }
    const type = (request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
    if (!type || !audioTypes.includes(type)) {
      sendError(response, 415, "Recording must be audio/webm or audio/ogg");
      return;
    }
    const recording = await readBody(request, maxRecordingBytes);
    if (!recording) {
      sendError(response, 413, "Recording is too large");
      return;
    }
    if (recording.length === 0) {
      sendError(response, 400, "Recording is empty");
      return;
    }

    const form = new FormData();
    form.set("model_id", "scribe_v2");
    form.set("tag_audio_events", "false");
    form.set("file", new Blob([recording], { type }), `recording.${type.slice("audio/".length)}`);

    let text: string;
    try {
      const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": options.apiKey },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!upstream.ok) {
        sendError(response, 502, `Speech-to-text failed: ${upstream.status}`);
        return;
      }
      text = transcriptSchema.parse(await upstream.json()).text.trim();
    } catch {
      sendError(response, 502, "Speech-to-text failed: unreachable");
      return;
    }
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ text }));
  };
}
