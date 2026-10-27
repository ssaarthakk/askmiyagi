import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribe } from "./transcribe.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribe", () => {
  const recording = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm;codecs=opus" });

  it("posts the raw recording with the token and returns the text", async () => {
    const stub = vi.fn(async () => Response.json({ text: "where does it start" }));
    vi.stubGlobal("fetch", stub);

    const text = await transcribe(recording, "tok");

    expect(text).toBe("where does it start");
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-miyagi-token": "tok",
      "content-type": "audio/webm;codecs=opus",
    });
    expect(init.body).toBe(recording);
  });

  it("throws the server's error message", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "Speech-to-text failed: 401" }, { status: 502 }),
    );

    await expect(transcribe(recording, "tok")).rejects.toThrow("Speech-to-text failed: 401");
  });

  it("throws when the answer is not a transcript", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ nope: 1 }));

    await expect(transcribe(recording, "tok")).rejects.toThrow();
  });
});
