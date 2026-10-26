import { afterEach, describe, expect, it, vi } from "vitest";
import { ackPhrases } from "../shared/phrases.ts";
import { browserSpeaker, chooseSpeaker, localVoices, noLocalVoice } from "./speaker.ts";

type FakeUtterance = {
  text: string;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

const local = { name: "local", localService: true } as SpeechSynthesisVoice;
const cloud = { name: "cloud", localService: false } as SpeechSynthesisVoice;

function fakeSynthesis(voices: SpeechSynthesisVoice[]) {
  const spoken: FakeUtterance[] = [];
  const synthesis = {
    getVoices: () => voices,
    speak: (utterance: FakeUtterance) => spoken.push(utterance),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
  } as unknown as SpeechSynthesis;
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      voice = null;
      onstart = null;
      onend = null;
      onerror = null;
      constructor(public text: string) {}
    },
  );
  return { synthesis, spoken };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browserSpeaker", () => {
  it("speaks with a local voice only and resolves when the audio ends", async () => {
    const { synthesis, spoken } = fakeSynthesis([cloud, local]);
    let finished = false;
    const done = browserSpeaker(synthesis)
      .speak("hello", new AbortController().signal)
      .then(() => {
        finished = true;
      });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(spoken[0]?.text).toBe("hello");
    expect(spoken[0]?.voice).toBe(local);
    expect(finished).toBe(false);
    spoken[0]?.onend?.();
    await done;
    expect(finished).toBe(true);
  });

  it("reports the start when the voice begins to speak, not when it is queued", async () => {
    const { synthesis, spoken } = fakeSynthesis([local]);
    const onStart = vi.fn();
    const done = browserSpeaker(synthesis).speak("hello", new AbortController().signal, onStart);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    expect(onStart).not.toHaveBeenCalled();

    spoken[0]?.onstart?.();
    spoken[0]?.onend?.();

    await done;
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("stops at once when aborted", async () => {
    const { synthesis, spoken } = fakeSynthesis([local]);
    const controller = new AbortController();
    const done = browserSpeaker(synthesis).speak("hello", controller.signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    controller.abort();

    await done;
    expect(synthesis.cancel).toHaveBeenCalled();
  });

  it("fails with the synthesis error instead of counting the segment as spoken", async () => {
    const { synthesis, spoken } = fakeSynthesis([local]);
    const done = browserSpeaker(synthesis).speak("hello", new AbortController().signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    spoken[0]?.onerror?.({ error: "synthesis-failed" });

    await expect(done).rejects.toThrow("synthesis-failed");
  });

  it("treats the error from its own cancel after an abort as a normal end", async () => {
    const { synthesis, spoken } = fakeSynthesis([local]);
    const controller = new AbortController();
    const done = browserSpeaker(synthesis).speak("hello", controller.signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    controller.abort();
    spoken[0]?.onerror?.({ error: "canceled" });

    await expect(done).resolves.toBeUndefined();
  });

  it("fails with the text-mode message when only cloud voices exist", async () => {
    const { synthesis, spoken } = fakeSynthesis([cloud]);

    await expect(
      browserSpeaker(synthesis).speak("hello", new AbortController().signal),
    ).rejects.toThrow(noLocalVoice);
    expect(spoken).toHaveLength(0);
  });
});

describe("localVoices", () => {
  it("gives up waiting for voices after a moment", async () => {
    vi.useFakeTimers();
    const { synthesis } = fakeSynthesis([]);
    const voices = localVoices(synthesis);

    await vi.advanceTimersByTimeAsync(2000);

    expect(await voices).toEqual([]);
  });
});

describe("chooseSpeaker", () => {
  function stubBrowser() {
    const { synthesis, spoken } = fakeSynthesis([local]);
    vi.stubGlobal("speechSynthesis", synthesis);
    return spoken;
  }

  it("uses the browser voice for anything but elevenlabs", async () => {
    const spoken = stubBrowser();
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);

    void chooseSpeaker("browser", "tok", vi.fn()).speak("hello", new AbortController().signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("fetches the acknowledgement phrases once at start for elevenlabs", () => {
    stubBrowser();
    const fetchStub = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("audio-bytes"),
    );
    vi.stubGlobal("fetch", fetchStub);

    chooseSpeaker("elevenlabs", "tok", vi.fn());

    const texts = fetchStub.mock.calls.map(([, init]) => JSON.parse(String(init.body)).text);
    expect(texts).toEqual(ackPhrases);
  });

  it("uses ElevenLabs for elevenlabs and shows the failure notice before the browser voice speaks", async () => {
    const spoken = stubBrowser();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
    const notify = vi.fn();

    void chooseSpeaker("elevenlabs", "tok", notify).speak("hello", new AbortController().signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(notify).toHaveBeenCalledWith("ElevenLabs failed, using the browser voice");
  });
});
