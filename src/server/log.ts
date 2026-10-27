import { redact } from "./files/redact.ts";

export function logError(message: string) {
  const printable = redact(message).replace(/(?!\n)\p{Cc}/gu, "");
  process.stderr.write(`miyagi: ${printable}\n`);
}

export function describeError(error: unknown, apiKey: string) {
  const cause =
    error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  const message = error instanceof Error ? `${error.message}${cause}` : String(error);
  return message.replaceAll(apiKey, "[REDACTED]").trim().slice(0, 500);
}
