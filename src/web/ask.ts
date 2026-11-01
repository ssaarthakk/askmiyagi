import type { Selection } from "../shared/anchor.ts";
import { type AskEvent, askEventSchema } from "../shared/events.ts";
import { responseError } from "./response-error.ts";
import { readEvents } from "./sse.ts";

export async function ask(
  question: string,
  token: string,
  selection: Selection | undefined,
  onEvent: (event: AskEvent) => void,
) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ question, selection }),
  });
  if (!response.ok || !response.body) throw await responseError(response, "Ask");
  await readEvents(response.body, askEventSchema, onEvent);
}
