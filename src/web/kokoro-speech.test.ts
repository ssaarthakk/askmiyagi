import { describe, expect, it, vi } from "vitest";
import { speakSentences } from "./kokoro-speech.ts";

function fakeModel() {
  return {
    generate: vi.fn(async (text: string) => ({
      audio: new Float32Array(text.length).fill(text.length),
      sampling_rate: 24000,
    })),
  };
}

describe("speakSentences", () => {
  const signal = new AbortController().signal;

  it("speaks a long text sentence by sentence and joins the audio, so nothing is cut off", async () => {
    const model = fakeModel();
    const sentences = ["First comes the clip.", "Then it is uploaded!", "Done?"];

    const audio = await speakSentences(model, sentences.join(" "), signal);

    expect(model.generate.mock.calls.map(([text]) => text)).toEqual(sentences);
    expect(audio.sampling_rate).toBe(24000);
    expect([...audio.audio]).toEqual(
      sentences.flatMap((sentence) => Array(sentence.length).fill(sentence.length)),
    );
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
