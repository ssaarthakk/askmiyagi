import type { Selection } from "../shared/anchor.ts";
import { type AskEvent, askEventSchema } from "../shared/events.ts";
import type { Current } from "../shared/tour.ts";
import { responseError } from "./response-error.ts";
import { readEvents } from "./sse.ts";

export async function ask(
  question: string,
  token: string,
  selection: Selection | undefined,
  current: Current | undefined,
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ question, selection, current }),
    signal,
  });
  if (!response.ok || !response.body) throw await responseError(response, "Ask");
  await readEvents(response.body, askEventSchema, onEvent);
}

export async function interruptAsk(token: string) {
  const response = await fetch("/api/interrupt", {
    method: "POST",
    headers: { "x-miyagi-token": token },
  });
  if (!response.ok) throw await responseError(response, "Interrupting the answer");
}
