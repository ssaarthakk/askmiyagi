import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askEventSchema } from "../src/shared/events.ts";
import { ackPhrases } from "../src/shared/phrases.ts";
import { requestPath, sourceCli, startCli, startServer, waitForExit } from "./cli-harness.ts";
import { fakeEnv, recorded } from "./fake-claude.ts";

const basic = "test/fixtures/basic";
const recordings = "test/fixtures/recordings";
const question = JSON.stringify({ question: "How are clips saved?" });

function fake(recording: string) {
  return ["--provider", "fake", "--recording", `${recordings}/${recording}`];
}

function post(url: string, token: string, body: string, signal?: AbortSignal) {
  return fetch(new URL("/api/ask", url), {
    method: "POST",
    headers: { "x-miyagi-token": token, "content-type": "application/json" },
    body,
    signal,
  });
}

async function readEvents(response: Response) {
  const blocks = (await response.text()).split("\n\n").filter((block) => block.trim() !== "");
  return blocks.map((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    return askEventSchema.parse(JSON.parse(data?.slice("data: ".length) ?? ""));
  });
}

describe("POST /api/ask security", () => {
  it("refuses a missing or wrong token, a foreign Origin and a foreign Host before Claude starts", async () => {
    const { env, work } = await fakeEnv("ok");
    const { url, token } = await startServer(basic, [], env);
    const port = new URL(url).port;
    const unauthorized = { status: 401, body: '{"error":"Unauthorized"}' };

    await expect(requestPath(url, "/api/ask", {}, "POST")).resolves.toEqual(unauthorized);
    await expect(
      requestPath(url, "/api/ask", { "x-miyagi-token": "wrong" }, "POST"),
    ).resolves.toEqual(unauthorized);
    await expect(
      requestPath(
        url,
        "/api/ask",
        { "x-miyagi-token": token, origin: "http://evil.example" },
        "POST",
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      requestPath(
        url,
        "/api/ask",
        { "x-miyagi-token": token, host: `evil.example:${port}` },
        "POST",
      ),
    ).resolves.toMatchObject({ status: 403 });
    await expect(stat(join(work, "record.json"))).rejects.toThrow();
  });
});

describe("POST /api/ask", () => {
  it("answers 400 to a body over 100 KB", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const response = await post(url, token, "x".repeat(100_001));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request body is too large" });
  });

  it.skipIf(process.platform === "win32")(
    "closes cleanly on Ctrl+C while an ask is running",
    async () => {
      const { server, url, token } = await startServer(basic, fake("ask-slow.jsonl"));
      const response = await post(url, token, question);
      expect(response.status).toBe(200);
      server.child.kill("SIGINT");
      await expect(waitForExit(server.child)).resolves.toMatchObject({ code: 0 });
    },
    5000,
  );

  it("streams ack, progress, steps, a tour with verified ranges, then done", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const response = await post(url, token, question);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const events = await readEvents(response);
    expect(events.map((event) => event.type)).toEqual([
      "ack",
      "progress",
      "step",
      "step",
      "tour",
      "done",
    ]);
    expect(events[1]).toEqual({ type: "progress", text: "Looking at clip-service.ts" });
    const final = events[4];
    expect(final?.type === "tour" && final.ranges).toEqual([
      [{ file: "src/clip-service.ts", start: 2, end: 4, capped: false }],
      [{ file: "src/upload.ts", start: 1, end: 3, capped: false }, null],
    ]);
    expect(final?.type === "tour" && final.tour.question).toBe("How are clips saved?");
  });

  it("rotates the acknowledgement phrase from one ask to the next", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const phrases: string[] = [];
    for (let index = 0; index <= ackPhrases.length; index++) {
      const first = (await readEvents(await post(url, token, question)))[0];
      phrases.push(first?.type === "ack" ? first.text : "");
    }
    expect(phrases).toEqual([...ackPhrases, ackPhrases[0]]);
  });

  it("rejects a bad body with 400", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const selection = (value: unknown) => JSON.stringify({ question: "Why?", selection: value });
    for (const body of [
      "not json",
      "{}",
      JSON.stringify({ question: "" }),
      "[]",
      selection("garbage"),
      selection({ file: "src/upload.ts", start: 0, end: 3, text: "x" }),
    ]) {
      const response = await post(url, token, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: expect.any(String) });
    }
  });

  it("accepts a valid selection", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const selection = { file: "src/upload.ts", start: 1, end: 3, text: "export" };
    const response = await post(url, token, JSON.stringify({ question: "Why?", selection }));
    expect(response.status).toBe(200);
    expect((await readEvents(response)).at(-1)?.type).toBe("done");
  });

  it("drops a selection that does not match the file and says so", async () => {
    const { url, token } = await startServer(basic, fake("ask-tour.jsonl"));
    const selection = { file: "src/upload.ts", start: 1, end: 3, text: "not in the file" };
    const response = await post(url, token, JSON.stringify({ question: "Why?", selection }));
    const events = await readEvents(response);
    expect(events[1]).toEqual({
      type: "progress",
      text: "Ignoring the selection: lines 1-3 of src/upload.ts do not contain the selected text",
    });
  });

  it("streams ack and progress while the provider is still running", async () => {
    const { url, token } = await startServer(basic, fake("ask-slow.jsonl"));
    const controller = new AbortController();
    const response = await post(url, token, question, controller.signal);
    const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
    const started = Date.now();
    let text = "";
    while (!text.includes('"type":"progress"')) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
      text += chunk.value;
    }
    expect(Date.now() - started).toBeLessThan(5000);
    expect(text).toContain('"type":"ack"');
    expect(text).toContain('"type":"progress"');
    expect(text).not.toContain('"type":"done"');
    controller.abort();
    await reader?.cancel().catch(() => undefined);
  });

  it("answers 409 to a second ask while one is running, then accepts asks again", async () => {
    const { url, token } = await startServer(basic, fake("ask-slow.jsonl"));
    const controller = new AbortController();
    const first = await post(url, token, question, controller.signal);
    expect(first.status).toBe(200);

    const second = await post(url, token, question);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: expect.any(String) });

    controller.abort();
    await first.body?.cancel().catch(() => undefined);
    await expect
      .poll(
        async () => {
          const retry = await post(url, token, question);
          await retry.body?.cancel().catch(() => undefined);
          return retry.status;
        },
        { timeout: 5000 },
      )
      .toBe(200);
  });

  it("ends with an error event when the model's output was invalid", async () => {
    const { url, token } = await startServer(basic, fake("ask-invalid.jsonl"));
    const events = await readEvents(await post(url, token, question));
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "error"]);
  });
});

describe("--brute-force-tokens", () => {
  it.each(["0", "-5", "1.5", "abc"])("rejects %s", async (value) => {
    const server = startCli(sourceCli, ["--no-open", "--brute-force-tokens", value]);
    await expect(waitForExit(server.child)).resolves.toMatchObject({ code: 1 });
    expect(server.stderr).toContain("brute-force-tokens");
  });

  it.each([
    { flag: [], mode: "the whole repo" },
    { flag: ["--brute-force-tokens", "1"], mode: "the repo map" },
  ])("sends $mode to the model with $flag", async ({ flag, mode }) => {
    const { env, work } = await fakeEnv("ok");
    const { url, token } = await startServer(basic, flag, env);
    await (await post(url, token, question)).text();
    const { stdin } = await recorded(work);
    expect(stdin.includes("=== src/clip-service.ts ===")).toBe(mode === "the whole repo");
  });
});
