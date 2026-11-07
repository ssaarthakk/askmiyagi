import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheModelFile, chatterboxVoice, requireHalfFloats } from "./chatterbox-speech.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatterboxVoice", () => {
  it("speaks the text with the encoded speaker and returns 24 kHz audio", async () => {
    const waveform = new Float32Array([0.1, -0.1]);
    const model = { generate: vi.fn(async () => ({ data: waveform })) };
    const processor = vi.fn(async (text: string) => ({ input_ids: text }));
    const speaker = { speaker_embeddings: "voice" };

    const clip = await chatterboxVoice(model, processor, speaker).generate("Hello there.");

    expect(processor).toHaveBeenCalledWith("Hello there.");
    expect(model.generate).toHaveBeenCalledWith({
      input_ids: "Hello there.",
      speaker_embeddings: "voice",
      exaggeration: 0.5,
      max_new_tokens: 1000,
    });
    expect(clip).toEqual({ audio: waveform, sampling_rate: 24000 });
  });
});

describe("cacheModelFile", () => {
  const url = "https://huggingface.co/model/resolve/main/onnx/part.onnx_data";

  function fakeCache(cached?: Response) {
    const stored = new Map<string, ArrayBuffer>();
    return {
      stored,
      match: vi.fn(async () => cached),
      put: vi.fn(async (key: string, response: Response) => {
        stored.set(key, await response.arrayBuffer());
      }),
    };
  }

  function serve(response: Response) {
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("streams the file into the cache and reports its progress", async () => {
    const cache = fakeCache();
    serve(new Response("abcd", { headers: { "content-length": "4" } }));
    const progress = vi.fn();

    await cacheModelFile(cache, url, "onnx/part.onnx_data", progress);

    expect(new TextDecoder().decode(cache.stored.get(url))).toBe("abcd");
    expect(progress).toHaveBeenLastCalledWith({
      status: "progress",
      file: "onnx/part.onnx_data",
      loaded: 4,
      total: 4,
    });
  });

  it("does not download a file that is already cached", async () => {
    const cache = fakeCache(new Response("abcd"));
    const fetch = serve(new Response("new"));

    await cacheModelFile(cache, url, "onnx/part.onnx_data", vi.fn());

    expect(fetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("fails with the status and caches nothing when the download is refused", async () => {
    const cache = fakeCache();
    serve(new Response("gone", { status: 404 }));

    await expect(cacheModelFile(cache, url, "onnx/part.onnx_data", vi.fn())).rejects.toThrow(
      "Could not download onnx/part.onnx_data (404)",
    );
    expect(cache.stored.size).toBe(0);
  });

  it("fails and caches nothing when the download is cut short", async () => {
    const cache = fakeCache();
    serve(new Response("ab", { headers: { "content-length": "4" } }));

    await expect(cacheModelFile(cache, url, "onnx/part.onnx_data", vi.fn())).rejects.toThrow(
      "The download of onnx/part.onnx_data was cut short",
    );
    expect(cache.stored.size).toBe(0);
  });

  it("reports no progress when the size is unknown", async () => {
    const cache = fakeCache();
    serve(new Response(new Blob(["abcd"]).stream()));
    const progress = vi.fn();

    await cacheModelFile(cache, url, "onnx/part.onnx_data", progress);

    expect(cache.stored.size).toBe(1);
    expect(progress).not.toHaveBeenCalled();
  });
});

describe("requireHalfFloats", () => {
  const gpu = (features: string[]) => ({
    requestAdapter: async () => ({ features: new Set(features) }),
  });

  it("accepts a GPU with 16-bit float shaders", async () => {
    await expect(requireHalfFloats(gpu(["shader-f16"]))).resolves.toBeUndefined();
  });

  it("refuses a GPU without them, before anything downloads", async () => {
    await expect(requireHalfFloats(gpu([]))).rejects.toThrow(
      "Chatterbox needs a GPU with 16-bit float shaders",
    );
  });
});
