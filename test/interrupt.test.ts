import { describe, expect, it } from "vitest";
import { startServer } from "./cli-harness.ts";

const basic = "test/fixtures/basic";
const slowAsk = ["--provider", "fake", "--recording", "test/fixtures/recordings/ask-slow.jsonl"];
const question = JSON.stringify({ question: "How are clips saved?" });

function post(url: string, path: string, token: string, body = "{}") {
  return fetch(new URL(path, url), {
    method: "POST",
    headers: { "x-miyagi-token": token, "content-type": "application/json" },
    body,
  });
}

describe("POST /api/interrupt", () => {
  it("answers 204 when nothing is running", async () => {
    const { url, token } = await startServer(basic, slowAsk);

    const response = await post(url, "/api/interrupt", token);

    expect(response.status).toBe(204);
  });

  it("aborts the running ask, ends its stream and lets the next ask start at once", async () => {
    const { url, token } = await startServer(basic, slowAsk);
    const running = await post(url, "/api/ask", token, question);
    expect(running.status).toBe(200);

    const interrupted = await post(url, "/api/interrupt", token);
    const next = await post(url, "/api/ask", token, question);
    const ended = await running.text();

    expect(interrupted.status).toBe(204);
    expect(ended).not.toContain('"type":"done"');
    expect(next.status).toBe(200);
    await next.body?.cancel();
  });
});
