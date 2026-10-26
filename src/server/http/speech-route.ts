import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { redact } from "../files/redact.ts";
import { readJsonBody, sendError } from "./ask-route.ts";

const speechBodySchema = z.object({ text: z.string().min(1).max(2000) });
const timeoutMs = 15_000;

export function createSpeechHandler(options: { apiKey?: string | undefined; voiceId: string }) {
  const cache = new Map<string, Buffer>();

  return async function handleSpeech(request: IncomingMessage, response: ServerResponse) {
    if (!options.apiKey) {
      sendError(response, 404, "Not found");
      return;
    }
    const body = await readJsonBody(request, response, speechBodySchema);
    if (!body) return;

    const speech = redact(body.text);
    const cacheKey = createHash("sha256")
      .update(options.voiceId)
      .update("\n")
      .update(speech)
      .digest("hex");
    let audio = cache.get(cacheKey);
    if (!audio) {
      let upstream: Response;
      try {
        upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: { "xi-api-key": options.apiKey, "content-type": "application/json" },
            body: JSON.stringify({ text: speech, model_id: "eleven_flash_v2_5" }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        if (upstream.ok) audio = Buffer.from(await upstream.arrayBuffer());
      } catch {
        sendError(response, 502, "Voice service failed: unreachable");
        return;
      }
      if (!audio?.length) {
        sendError(response, 502, `Voice service failed: ${upstream.status}`);
        return;
      }
      cache.set(cacheKey, audio);
    }
    response.writeHead(200, { "content-type": "audio/mpeg", "content-length": audio.length });
    response.end(audio);
  };
}
