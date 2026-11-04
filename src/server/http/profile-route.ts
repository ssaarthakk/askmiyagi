import type { IncomingMessage, ServerResponse } from "node:http";
import { profileSchema } from "../../shared/profile.ts";
import { readProfile, writeProfile } from "../teach/profile.ts";
import { readJsonBody, sendError } from "./ask-route.ts";

export function createProfileHandler(tutorRoot: string) {
  return async function handleProfile(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "PUT") {
      const body = await readJsonBody(request, response, profileSchema);
      if (!body) return;
      const saved = await writeProfile(tutorRoot, body);
      if (!saved.ok) {
        sendError(response, 500, "Could not save the profile", saved.error);
        return;
      }
    }
    const profile = await readProfile(tutorRoot);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(profile));
  };
}
