import { type WatchEvent, watchEventSchema } from "../shared/events.ts";
import { responseError } from "./response-error.ts";
import { readEvents } from "./sse.ts";

export async function watchCode(token: string, onEvent: (event: WatchEvent) => void) {
  const response = await fetch("/api/events", { headers: { "x-miyagi-token": token } });
  if (!response.ok || !response.body) throw await responseError(response, "Watching the code");
  await readEvents(response.body, watchEventSchema, onEvent);
}
