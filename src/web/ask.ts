import { type AskEvent, askEventSchema } from "../shared/events.ts";
import { responseError } from "./response-error.ts";

export async function ask(question: string, token: string, onEvent: (event: AskEvent) => void) {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ question }),
  });
  if (!response.ok || !response.body) throw await responseError(response, "Ask");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += value;
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (data) onEvent(askEventSchema.parse(JSON.parse(data.slice("data: ".length))));
    }
  }
}
