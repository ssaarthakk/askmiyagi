import { describe, expect, it } from "vitest";
import { encodeWav, wavSamples } from "./wav.ts";

describe("encodeWav", () => {
  it("writes mono 16-bit PCM at the given rate with samples clipped to the valid range", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]), 24_000);

    expect(wav.type).toBe("audio/wav");
    const view = new DataView(await wav.arrayBuffer());
    const text = (at: number) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    const samples = [0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true));
    expect(samples).toEqual([0, 16383, -32768, 32767]);
  });
});

describe("wavSamples", () => {
  function floatWav(samples: number[], options: { channels?: number; extra?: number } = {}) {
    const extra = options.extra ?? 0;
    const padded = extra + (extra % 2);
    const view = new DataView(new ArrayBuffer(44 + (extra ? 8 + padded : 0) + samples.length * 4));
    const text = (at: number, value: string) => {
      for (const [index, char] of [...value].entries())
        view.setUint8(at + index, char.charCodeAt(0));
    };
    text(0, "RIFF");
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, options.channels ?? 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint16(34, 32, true);
    let data = 36;
    if (extra) {
      text(36, "LIST");
      view.setUint32(40, extra, true);
      data = 44 + padded;
    }
    text(data, "data");
    view.setUint32(data + 4, samples.length * 4, true);
    for (const [index, sample] of samples.entries())
      view.setFloat32(data + 8 + index * 4, sample, true);
    return view.buffer;
  }

  it("reads a mono float WAV, like Chatterbox's default voice", () => {
    expect(wavSamples(floatWav([0.25, -0.5]))).toEqual({
      samples: new Float32Array([0.25, -0.5]),
      sampleRate: 24_000,
    });
  });

  it("skips an odd-sized chunk before the samples", () => {
    expect(wavSamples(floatWav([0.25], { extra: 3 })).samples).toEqual(new Float32Array([0.25]));
  });

  it("refuses a WAV that is not mono 32-bit float", async () => {
    expect(() => wavSamples(floatWav([0.25, -0.5], { channels: 2 }))).toThrow(
      "The voice sample must be a mono 32-bit float WAV",
    );
    const pcm = await encodeWav(new Float32Array([0, -1]), 16_000).arrayBuffer();
    expect(() => wavSamples(pcm)).toThrow("The voice sample must be a mono 32-bit float WAV");
  });

  it("refuses a file that is not a WAV", () => {
    expect(() => wavSamples(new ArrayBuffer(64))).toThrow("not a WAV file");
  });
});
