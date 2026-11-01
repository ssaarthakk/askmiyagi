import type { z } from "zod";

export async function readEvents<T>(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  schema: z.ZodType<T>,
  onEvent: (event: T) => void,
) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += value;
    const blocks = buffered.split("\n\n");
    buffered = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (data) onEvent(schema.parse(JSON.parse(data.slice("data: ".length))));
    }
  }
}
