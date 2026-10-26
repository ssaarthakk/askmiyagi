import { createServer, type IncomingMessage, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../cli.ts";
import { createSpeechHandler } from "./speech-route.ts";

const apiKey = "fake-elevenlabs-key";
const voiceId = "voice-one";
const audio = Buffer.from([1, 2, 3, 4, 5]);
const servers: Server[] = [];

async function start(options: { apiKey?: string | undefined; voiceId: string }) {
  const handler = createSpeechHandler(options);
  const server = createServer((incoming, response) => {
    void handler(incoming, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return (body: string) =>
    new Promise<{ status: number; type: string | undefined; body: Buffer }>((resolve, reject) => {
      const outgoing = request(
        { host: "127.0.0.1", port, method: "POST", path: "/api/speech" },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              type: response.headers["content-type"],
              body: Buffer.concat(chunks),
            }),
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

function okAudio() {
  return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("POST /api/speech", () => {
  it("posts the text to ElevenLabs with the key and returns the audio", async () => {
    const stub = stubElevenLabs(okAudio);
    const post = await start({ apiKey, voiceId });

    const result = await post(JSON.stringify({ text: "Hello there" }));

    expect(result.status).toBe(200);
    expect(result.type).toBe("audio/mpeg");
    expect(result.body.equals(audio)).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe(apiKey);
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "Hello there",
      model_id: "eleven_flash_v2_5",
    });
  });

  it("redacts secrets from the text before it leaves the machine", async () => {
    const stub = stubElevenLabs(okAudio);
    const post = await start({ apiKey, voiceId });
    const secret = "sk-ant-abcdefghijklmnopqrstuvwxyz";

    await post(JSON.stringify({ text: `The key is ${secret} here` }));

    const sent = String(stub.mock.calls[0]?.[1]?.body);
    expect(sent).not.toContain(secret);
    expect(sent).toContain("[REDACTED]");
  });

  it("answers repeated text from memory without calling ElevenLabs again", async () => {
    const stub = stubElevenLabs(okAudio);
    const post = await start({ apiKey, voiceId });

    const first = await post(JSON.stringify({ text: "Same words" }));
    const second = await post(JSON.stringify({ text: "Same words" }));
    await post(JSON.stringify({ text: "Other words" }));

    expect(second.status).toBe(200);
    expect(second.body.equals(first.body)).toBe(true);
    expect(stub).toHaveBeenCalledTimes(2);
  });

  it("refuses an empty, too long, malformed or missing body with 400 and never calls ElevenLabs", async () => {
    const stub = stubElevenLabs(okAudio);
    const post = await start({ apiKey, voiceId });

    for (const body of [
      JSON.stringify({ text: "" }),
      JSON.stringify({ text: "a".repeat(2001) }),
      JSON.stringify({}),
      JSON.stringify({ text: 5 }),
      "not json",
    ]) {
      const result = await post(body);
      expect(result.status).toBe(400);
      expect(JSON.parse(result.body.toString())).toEqual({ error: expect.any(String) });
    }
    expect(stub).not.toHaveBeenCalled();
  });

  it("accepts text of exactly 2,000 characters", async () => {
    stubElevenLabs(okAudio);
    const post = await start({ apiKey, voiceId });

    const result = await post(JSON.stringify({ text: "a".repeat(2000) }));

    expect(result.status).toBe(200);
  });

  it("answers 404 when the voice is not elevenlabs", async () => {
    const stub = stubElevenLabs(okAudio);
    const post = await start({ voiceId });

    const result = await post(JSON.stringify({ text: "Hello" }));

    expect(result.status).toBe(404);
    expect(stub).not.toHaveBeenCalled();
  });

  it("answers 502 with the ElevenLabs status and never leaks the key", async () => {
    stubElevenLabs(
      () => new Response(`bad key ${apiKey}`, { status: 401, headers: { "xi-api-key": apiKey } }),
    );
    const post = await start({ apiKey, voiceId });

    const result = await post(JSON.stringify({ text: "Hello" }));

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body.toString())).toEqual({ error: "Voice service failed: 401" });
    expect(result.body.toString()).not.toContain(apiKey);
  });

  it("answers 502 when ElevenLabs cannot be reached and does not cache failures", async () => {
    let calls = 0;
    const stub = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error(`connect failed with ${apiKey}`))
        : Promise.resolve(okAudio());
    });
    vi.stubGlobal("fetch", stub);
    const post = await start({ apiKey, voiceId });

    const failed = await post(JSON.stringify({ text: "Hello" }));
    const retried = await post(JSON.stringify({ text: "Hello" }));

    expect(failed.status).toBe(502);
    expect(failed.body.toString()).not.toContain(apiKey);
    expect(retried.status).toBe(200);
  });

  it("answers 502 when ElevenLabs never answers", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason);
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const post = await start({ apiKey, voiceId });

    const result = await post(JSON.stringify({ text: "Hello" }));

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body.toString())).toEqual({
      error: "Voice service failed: unreachable",
    });
  });

  it("answers 502 when the audio stops arriving halfway", async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.error(new Error("connection reset"));
      },
    });
    stubElevenLabs(() => new Response(broken, { status: 200 }));
    const post = await start({ apiKey, voiceId });

    const result = await post(JSON.stringify({ text: "Hello" }));

    expect(result.status).toBe(502);
    expect(JSON.parse(result.body.toString())).toEqual({
      error: "Voice service failed: unreachable",
    });
  });
});

describe("POST /api/speech empty audio", () => {
  it("answers 502 for empty audio and does not cache it", async () => {
    let calls = 0;
    const stub = stubElevenLabs(() => {
      calls += 1;
      return calls === 1 ? new Response(new Uint8Array(), { status: 200 }) : okAudio();
    });
    const post = await start({ apiKey, voiceId });

    const empty = await post(JSON.stringify({ text: "Hello" }));
    const retried = await post(JSON.stringify({ text: "Hello" }));

    expect(empty.status).toBe(502);
    expect(retried.status).toBe(200);
    expect(stub).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(process.env.MIYAGI_LIVE !== "1" || !process.env.ELEVENLABS_API_KEY)(
  "ElevenLabs live",
  () => {
    it("returns real mp3 audio", async () => {
      const post = await start({
        apiKey: process.env.ELEVENLABS_API_KEY,
        voiceId: parseCliArgs([]).voiceId,
      });

      const result = await post(JSON.stringify({ text: "Hello from Miyagi." }));

      expect(result.status).toBe(200);
      expect(result.type).toBe("audio/mpeg");
      expect(result.body.length).toBeGreaterThan(1000);
    });
  },
);
