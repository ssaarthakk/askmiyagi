import { describe, expect, it, vi } from "vitest";
import { speakSentences } from "./kokoro-speech.ts";

function fakeModel(level = 0.1) {
  return {
    generate: vi.fn(async (text: string) => ({
      audio: new Float32Array(text.length).fill(level),
      sampling_rate: 24000,
    })),
  };
}

describe("speakSentences", () => {
  const signal = new AbortController().signal;

  it("speaks a long text sentence by sentence and joins the audio, so nothing is cut off", async () => {
    const model = fakeModel();
    const sentences = ["First comes the clip.", "Then it is uploaded!", "Done?"];

    const wav = await speakSentences(model, sentences.join(" "), signal);

    expect(model.generate.mock.calls.map(([text]) => text)).toEqual(sentences);
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(24000);
    const lengths = sentences.map((sentence) => sentence.length);
    expect(view.getUint32(40, true)).toBe(lengths.reduce((total, length) => total + length) * 2);
  });

  it("gives 16-bit PCM WAV, which every browser decodes, not the float WAV Firefox cannot", async () => {
    const wav = await speakSentences(fakeModel(0.5), "One sentence.", signal);

    const view = new DataView(await wav.arrayBuffer());
    expect(wav.type).toBe("audio/wav");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(16383);
  });

  it("stops between sentences once it is cancelled", async () => {
    const model = fakeModel();
    const controller = new AbortController();
    model.generate.mockImplementationOnce(async (text: string) => {
      controller.abort();
      return { audio: new Float32Array(text.length), sampling_rate: 24000 };
    });

    const audio = speakSentences(model, "One here. Two here.", controller.signal);

    await expect(audio).rejects.toThrow();
    expect(model.generate).toHaveBeenCalledOnce();
  });
});
