import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserSpeaker,
  chooseSpeaker,
  elevenLabsSpeaker,
  localVoices,
  noLocalVoice,
  type Speaker,
} from "./speaker.ts";

type FakeUtterance = {
  text: string;
  voice: SpeechSynthesisVoice | null;
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
      onend = null;
      onerror = null;
      constructor(public text: string) {}
    },
  );
  return { synthesis, spoken };
}

function stubAudio() {
  const played: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (audio: Blob) => {
      played.push(audio);
      return "blob:audio";
    },
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    "Audio",
    class {
      onended: (() => void) | null = null;
      play = () => {
        setTimeout(() => this.onended?.());
        return Promise.resolve();
      };
    },
  );
  return played;
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

describe("elevenLabsSpeaker", () => {
  const signal = new AbortController().signal;

  function fallbackSpeaker() {
    const spoken: string[] = [];
    const speaker: Speaker = {
      speak: async (text) => {
        spoken.push(text);
      },
    };
    return { speaker, spoken };
  }

  it("posts the text with the token and plays the returned audio", async () => {
    const fetchStub = vi.fn(async () => new Response("audio-bytes"));
    vi.stubGlobal("fetch", fetchStub);
    const played = stubAudio();
    const { speaker, spoken } = fallbackSpeaker();
    const onFallback = vi.fn();

    await elevenLabsSpeaker("tok", speaker, onFallback).speak("hello", signal);

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/speech");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-miyagi-token": "tok" });
    expect(JSON.parse(String(init.body))).toEqual({ text: "hello" });
    expect(await played[0]?.text()).toBe("audio-bytes");
    expect(spoken).toEqual([]);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("plays the segment with the fallback voice when the request fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
    const { speaker, spoken } = fallbackSpeaker();
    const onFallback = vi.fn();
    const played = stubAudio();

    await elevenLabsSpeaker("tok", speaker, onFallback).speak("hello", signal);

    expect(spoken).toEqual(["hello"]);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(played).toEqual([]);
  });

  it("falls back when the network fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    const { speaker, spoken } = fallbackSpeaker();

    await elevenLabsSpeaker("tok", speaker, vi.fn()).speak("hello", signal);

    expect(spoken).toEqual(["hello"]);
  });

  it("pauses the audio and resolves at once when aborted during playback", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio-bytes"));
    const revoked = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:audio", revokeObjectURL: revoked });
    const players: { pause: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        pause = vi.fn();
        play = () => new Promise<void>(() => {});
        constructor() {
          players.push(this);
        }
      },
    );
    const controller = new AbortController();
    const { speaker } = fallbackSpeaker();
    const done = elevenLabsSpeaker("tok", speaker, vi.fn()).speak("hello", controller.signal);
    await vi.waitFor(() => expect(players).toHaveLength(1));

    controller.abort();

    await expect(done).resolves.toBeUndefined();
    expect(players[0]?.pause).toHaveBeenCalled();
    expect(revoked).toHaveBeenCalledWith("blob:audio");
  });

  it("never plays audio that arrives after an abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      blob: async () => {
        controller.abort();
        return new Blob(["audio-bytes"]);
      },
    }));
    const played = stubAudio();
    const { speaker } = fallbackSpeaker();

    await elevenLabsSpeaker("tok", speaker, vi.fn()).speak("hello", controller.signal);

    expect(played).toEqual([]);
  });

  it("does not fall back when aborted", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const controller = new AbortController();
    controller.abort();
    const { speaker, spoken } = fallbackSpeaker();
    const onFallback = vi.fn();

    await elevenLabsSpeaker("tok", speaker, onFallback).speak("hello", controller.signal);

    expect(spoken).toEqual([]);
    expect(onFallback).not.toHaveBeenCalled();
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

  it("uses ElevenLabs for elevenlabs and shows the failure notice before the browser voice speaks", async () => {
    const spoken = stubBrowser();
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 502 }));
    const notify = vi.fn();

    void chooseSpeaker("elevenlabs", "tok", notify).speak("hello", new AbortController().signal);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    expect(notify).toHaveBeenCalledWith("ElevenLabs failed, using the browser voice");
  });
});
