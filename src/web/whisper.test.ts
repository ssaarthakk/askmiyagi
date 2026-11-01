import { describe, expect, it, vi } from "vitest";
import { createLocalTranscriber } from "./whisper.ts";

describe("createLocalTranscriber", () => {
  const recording = new Blob(["audio"], { type: "audio/webm" });
  const samples = new Float32Array([0.5]);
  const decode = vi.fn(async () => samples);

  function engineThatSays(text: string) {
    return { ready: Promise.resolve(), stopped: false, run: vi.fn(async () => text) };
  }

  it("decodes the recording, transcribes it and loads the model only once", async () => {
    const engine = engineThatSays("how are clips saved");
    const start = vi.fn(() => engine);
    const transcribe = createLocalTranscriber(start, decode);

    await expect(transcribe(recording, vi.fn())).resolves.toBe("how are clips saved");
    await transcribe(recording, vi.fn());

    expect(engine.run).toHaveBeenCalledWith(samples, [samples.buffer]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("tells the caller how far the model download has got", async () => {
    const notify = vi.fn();
    const transcribe = createLocalTranscriber((onProgress) => {
      onProgress(40);
      return engineThatSays("hello");
    }, decode);

    await transcribe(recording, notify);

    expect(notify).toHaveBeenCalledWith("Downloading the speech model: 40%");
  });

  it("starts a fresh load on the next recording after the model failed to load", async () => {
    const broken = { ready: Promise.reject(new Error("no network")), stopped: true, run: vi.fn() };
    const start = vi.fn().mockReturnValueOnce(broken).mockReturnValue(engineThatSays("hello"));
    const transcribe = createLocalTranscriber(start, decode);

    await expect(transcribe(recording, vi.fn())).rejects.toThrow("no network");
    await expect(transcribe(recording, vi.fn())).resolves.toBe("hello");
  });

  it("starts the model again on the next recording after its worker stopped", async () => {
    const crashed = {
      ready: Promise.resolve(),
      stopped: false,
      run: vi.fn(async () => {
        crashed.stopped = true;
        throw new Error("Speech-to-text stopped");
      }),
    };
    const start = vi.fn().mockReturnValueOnce(crashed).mockReturnValue(engineThatSays("hello"));
    const transcribe = createLocalTranscriber(start, decode);

    await expect(transcribe(recording, vi.fn())).rejects.toThrow("Speech-to-text stopped");
    await expect(transcribe(recording, vi.fn())).resolves.toBe("hello");
    expect(start).toHaveBeenCalledTimes(2);
  });
});
