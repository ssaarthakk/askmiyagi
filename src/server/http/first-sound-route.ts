import type { IncomingMessage, ServerResponse } from "node:http";
import { firstSoundSchema } from "../../shared/call-log.ts";
import { addFirstSound } from "../call-log.ts";
import { readJsonBody } from "./ask-route.ts";

export function createFirstSoundHandler(tutorRoot: string) {
  return async function handleFirstSound(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, firstSoundSchema);
    if (!body) return;
    await addFirstSound(tutorRoot, body.ms);
    response.writeHead(204);
    response.end();
  };
}
