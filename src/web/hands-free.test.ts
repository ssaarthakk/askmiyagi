import { afterEach, describe, expect, it, vi } from "vitest";

type DetectorOptions = Detection & {
  getStream: () => Promise<unknown>;
  resumeStream: (stream: unknown) => Promise<unknown>;
};

const created = vi.hoisted(() => [] as DetectorOptions[]);

vi.mock("@ricky0123/vad-web", () => ({
  MicVAD: {
    new: async (options: DetectorOptions) => {
      created.push(options);
      return { start: async () => {}, pause: async () => {} };
    },
  },
}));

import { type Detection, encodeWav, startDetector } from "./hands-free.ts";

afterEach(() => {
  created.length = 0;
  vi.unstubAllGlobals();
});

function detection() {
  return { onSpeechStart: vi.fn(), onVADMisfire: vi.fn(), onSpeechEnd: vi.fn() };
}

describe("startDetector", () => {
  it("counts speech of at least 300 ms as real and ends it after 0.65 s of silence", async () => {
    await startDetector(detection());

    expect(created[0]).toMatchObject({ model: "v5", minSpeechMs: 300, redemptionMs: 650 });
  });

  it("opens the microphone with echo cancellation, also when listening again", async () => {
    const stream = {};
    const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await startDetector(detection());

    const options = created[0] as DetectorOptions;
    expect(await options.getStream()).toBe(stream);
    expect(await options.resumeStream(stream)).toBe(stream);
    for (const [constraints] of getUserMedia.mock.calls) {
      expect(constraints).toEqual({ audio: { echoCancellation: true, noiseSuppression: true } });
    }
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe("encodeWav", () => {
  it("writes 16 kHz mono 16-bit PCM with samples clipped to the valid range", async () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1, 2]));

    expect(wav.type).toBe("audio/wav");
    const view = new DataView(await wav.arrayBuffer());
    const text = (at: number) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    const samples = [0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true));
    expect(samples).toEqual([0, 16383, -32768, 32767]);
  });
});
