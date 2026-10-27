import { createServer, type IncomingMessage, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranscribeHandler } from "./transcribe-route.ts";

const apiKey = "fake-elevenlabs-key";
const recording = Buffer.from([9, 8, 7, 6, 5]);
const maxBytes = 10 * 1024 * 1024;
const servers: Server[] = [];

async function start(options: { apiKey?: string | undefined }) {
  const handler = createTranscribeHandler(options);
  const server = createServer((incoming, response) => {
    void handler(incoming, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return (body: Buffer, contentType: string | null = "audio/webm") =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/transcribe",
          headers: contentType ? { "content-type": contentType } : {},
        },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      outgoing.once("error", reject);
      outgoing.end(body);
    });
}

function stubElevenLabs(response: () => Response) {
  const stub = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(response()),
  );
  vi.stubGlobal("fetch", stub);
  return stub;
}

function transcript(text: string) {
  return new Response(JSON.stringify({ text, language_code: "eng", words: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("POST /api/transcribe", () => {
  it("sends the recording to ElevenLabs speech-to-text with the key and returns the text", async () => {
    const stub = stubElevenLabs(() => transcript("How are clips saved?"));
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ text: "How are clips saved?" });
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe(apiKey);
    const form = init?.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/webm");
    expect(Buffer.from(await file.arrayBuffer()).equals(recording)).toBe(true);
  });

  it("accepts audio/ogg and a codecs parameter", async () => {
    const stub = stubElevenLabs(() => transcript("hello"));
    const post = await start({ apiKey });

    const ogg = await post(recording, "audio/ogg");
    const webm = await post(recording, "audio/webm;codecs=opus");

    expect(ogg.status).toBe(200);
    expect(webm.status).toBe(200);
    const sent = stub.mock.calls[1]?.[1]?.body as FormData;
    expect((sent.get("file") as File).type).toBe("audio/webm");
  });

  it("trims the transcript and returns an empty text when nothing was heard", async () => {
    stubElevenLabs(() => transcript("   "));
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ text: "" });
  });

  it("answers 404 when the voice is not elevenlabs", async () => {
    const stub = stubElevenLabs(() => transcript("hello"));
    const post = await start({});

    const result = await post(recording);

    expect(result.status).toBe(404);
    expect(stub).not.toHaveBeenCalled();
  });

  it("answers 413 for a recording over 10 MB and never calls ElevenLabs", async () => {
    const stub = stubElevenLabs(() => transcript("hello"));
    const post = await start({ apiKey });

    const result = await post(Buffer.alloc(maxBytes + 1));

    expect(result.status).toBe(413);
    expect(JSON.parse(result.body)).toEqual({ error: expect.any(String) });
    expect(stub).not.toHaveBeenCalled();
  });

  it("accepts a recording of exactly 10 MB", async () => {
    stubElevenLabs(() => transcript("hello"));
    const post = await start({ apiKey });

    const result = await post(Buffer.alloc(maxBytes));

    expect(result.status).toBe(200);
  });

  it("refuses other content types and empty recordings and never calls ElevenLabs", async () => {
    const stub = stubElevenLabs(() => transcript("hello"));
    const post = await start({ apiKey });

    const wrongType = await post(recording, "application/json");
    const noType = await post(recording, null);
    const empty = await post(Buffer.alloc(0));

    expect(wrongType.status).toBe(415);
    expect(noType.status).toBe(415);
    expect(empty.status).toBe(400);
    expect(stub).not.toHaveBeenCalled();
  });

  it("answers 502 with the ElevenLabs status and never leaks the key", async () => {
    stubElevenLabs(() => new Response(`bad key ${apiKey}`, { status: 401 }));
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ error: "Speech-to-text failed: 401" });
    expect(result.body).not.toContain(apiKey);
  });

  it("prints ElevenLabs' reason for a failure to the terminal, without the key", async () => {
    const terminal = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stubElevenLabs(
      () =>
        new Response(
          JSON.stringify({
            detail: {
              status: "missing_permissions",
              message: `The API key you used is missing the permission speech_to_text to execute this operation. Key: ${apiKey}`,
            },
          }),
          { status: 401 },
        ),
    );
    const post = await start({ apiKey });

    await post(recording);

    const printed = terminal.mock.calls.map(([text]) => String(text)).join("");
    expect(printed).toContain("Speech-to-text failed: 401");
    expect(printed).toContain(
      "The API key you used is missing the permission speech_to_text to execute this operation.",
    );
    expect(printed).not.toContain(apiKey);
  });

  it("prints why ElevenLabs could not be reached to the terminal", async () => {
    const terminal = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubGlobal("fetch", () => Promise.reject(new Error(`getaddrinfo ENOTFOUND with ${apiKey}`)));
    const post = await start({ apiKey });

    await post(recording);

    const printed = terminal.mock.calls.map(([text]) => String(text)).join("");
    expect(printed).toContain("Speech-to-text failed: unreachable");
    expect(printed).toContain("getaddrinfo ENOTFOUND");
    expect(printed).not.toContain(apiKey);
  });

  it("answers 502 when ElevenLabs cannot be reached", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error(`connect failed with ${apiKey}`)));
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ error: "Speech-to-text failed: unreachable" });
    expect(result.body).not.toContain(apiKey);
  });

  it("answers 502 when ElevenLabs does not answer within 30 seconds", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ error: "Speech-to-text failed: unreachable" });
  });

  it("answers 502 when ElevenLabs returns something that is not a transcript", async () => {
    stubElevenLabs(() => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const post = await start({ apiKey });

    const result = await post(recording);

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ error: "Speech-to-text failed: unreachable" });
  });
});
