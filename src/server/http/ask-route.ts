import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { selectionSchema } from "../../shared/anchor.ts";
import { parseContract } from "../../shared/parse.ts";
import { ackPhrases } from "../../shared/phrases.ts";
import { askEvents } from "../llm/ask.ts";
import type { LLMProvider } from "../llm/provider.ts";

const maxBodyBytes = 100_000;

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  selection: selectionSchema.optional(),
});

export function sendError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: message }));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += (chunk as Buffer).length;
    if (length <= maxBodyBytes) chunks.push(chunk as Buffer);
  }
  return length > maxBodyBytes ? undefined : Buffer.concat(chunks).toString("utf8");
}

export function createAskHandler(options: {
  root: string;
  provider: LLMProvider;
  bruteForceTokens?: number | undefined;
}) {
  let running = false;
  let asked = 0;

  return async function handleAsk(request: IncomingMessage, response: ServerResponse) {
    const text = await readBody(request);
    if (text === undefined) {
      sendError(response, 400, "Request body is too large");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      sendError(response, 400, "Request body is not valid JSON");
      return;
    }
    const body = parseContract(askBodySchema, json);
    if (!body.ok) {
      sendError(response, 400, body.error);
      return;
    }
    if (running) {
      sendError(response, 409, "An ask is already running");
      return;
    }

    running = true;
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const ack = ackPhrases[asked++ % ackPhrases.length] ?? "";
    try {
      for await (const event of askEvents({
        root: options.root,
        provider: options.provider,
        question: body.value.question,
        ack,
        signal: controller.signal,
        bruteForceTokens: options.bruteForceTokens,
      })) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      running = false;
      response.end();
    }
  };
}
