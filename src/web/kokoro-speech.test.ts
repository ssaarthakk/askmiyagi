import { describe, expect, it, vi } from "vitest";
import { speakText } from "./kokoro-speech.ts";

function fakeModel(level = 0.1) {
  return {
    generate: vi.fn(async (text: string) => ({
      audio: new Float32Array(text.length).fill(level),
      sampling_rate: 24000,
    })),
  };
}

describe("speakText", () => {
  const signal = new AbortController().signal;

  it("speaks the sentence it is given with the model's voice and sample rate", async () => {
    const model = fakeModel();

    const wav = await speakText(model, "First comes the clip.", signal);

    expect(model.generate).toHaveBeenCalledWith("First comes the clip.", { voice: "af_heart" });
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe("First comes the clip.".length * 2);
  });

  it("gives 16-bit PCM WAV, which every browser decodes, not the float WAV Firefox cannot", async () => {
    const wav = await speakText(fakeModel(0.5), "One sentence.", signal);

    const view = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe("audio/wav");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(16383);
  });

  it("gives no audio once it is cancelled", async () => {
    const model = fakeModel();
    const controller = new AbortController();
    model.generate.mockImplementationOnce(async (text: string) => {
      controller.abort();
      return { audio: new Float32Array(text.length), sampling_rate: 24000 };
    });

    await expect(speakText(model, "One here.", controller.signal)).rejects.toThrow();
  });
});
