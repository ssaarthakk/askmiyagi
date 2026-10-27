import { afterEach, describe, expect, it, vi } from "vitest";
import { startRecording } from "./recorder.ts";

function stubMicrophone() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const created: FakeRecorder[] = [];
  class FakeRecorder {
    mimeType = "audio/webm;codecs=opus";
    listeners: Record<string, ((event: unknown) => void)[]> = {};
    started = false;
    stream: unknown;
    options: unknown;
    static supported = ["audio/webm", "audio/ogg"];
    static isTypeSupported(type: string) {
      return FakeRecorder.supported.includes(type);
    }
    constructor(source: unknown, options: unknown) {
      if (FakeRecorder.failing) throw new Error("recorder failed");
      this.stream = source;
      this.options = options;
      created.push(this);
    }
    static failing = false;
    addEventListener(name: string, listener: (event: unknown) => void) {
      this.listeners[name] = [...(this.listeners[name] ?? []), listener];
    }
    start() {
      this.started = true;
    }
    stop() {
      for (const listener of this.listeners.dataavailable ?? []) {
        listener({ data: new Blob([new Uint8Array([1, 2])]) });
        listener({ data: new Blob([new Uint8Array([3])]) });
      }
      for (const listener of this.listeners.stop ?? []) listener({});
    }
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  return { getUserMedia, track, created, stream, FakeRecorder };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startRecording", () => {
  it("asks for the microphone with echo cancellation and noise suppression on", async () => {
    const { getUserMedia, created, stream } = stubMicrophone();

    await startRecording();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    expect(created[0]?.stream).toBe(stream);
    expect(created[0]?.started).toBe(true);
  });

  it("returns the recorded audio when stopped and releases the microphone", async () => {
    const { track } = stubMicrophone();

    const recording = await startRecording();
    expect(track.stop).not.toHaveBeenCalled();
    const audio = await recording.stop();

    expect(audio.type).toBe("audio/webm;codecs=opus");
    expect(audio.size).toBe(3);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("records webm, or ogg when the browser cannot record webm", async () => {
    const { created, FakeRecorder } = stubMicrophone();
    await startRecording();
    FakeRecorder.supported = ["audio/ogg"];
    await startRecording();

    expect(created.map((recorder) => recorder.options)).toEqual([
      { mimeType: "audio/webm" },
      { mimeType: "audio/ogg" },
    ]);
  });

  it("refuses before opening the microphone when the browser records neither webm nor ogg", async () => {
    const { getUserMedia, FakeRecorder } = stubMicrophone();
    FakeRecorder.supported = ["audio/mp4"];

    await expect(startRecording()).rejects.toThrow("This browser can't record webm or ogg audio");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("releases the microphone when the recorder cannot start", async () => {
    const { track, FakeRecorder } = stubMicrophone();
    FakeRecorder.failing = true;

    await expect(startRecording()).rejects.toThrow("recorder failed");
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("rejects when the microphone is denied", async () => {
    const { getUserMedia } = stubMicrophone();
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));

    await expect(startRecording()).rejects.toThrow();
  });
});
