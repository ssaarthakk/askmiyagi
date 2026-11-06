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

import { type Detection, startDetector } from "./hands-free.ts";

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
