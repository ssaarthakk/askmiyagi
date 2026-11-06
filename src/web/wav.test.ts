import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav.ts";

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
