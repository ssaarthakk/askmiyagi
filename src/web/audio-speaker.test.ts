import { afterEach, describe, expect, it, vi } from "vitest";
import { elevenLabsSpeaker } from "./speaker.ts";
import { fallbackSpeaker, stubAudio } from "./speaker-helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("elevenLabsSpeaker", () => {
  const signal = new AbortController().signal;

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

  it("plays the audio at the speed it was given and passes the speed to the fallback voice", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio-bytes"));
    const elements: { playbackRate: number }[] = [];
    stubAudio(elements);
    const { speaker, rates } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());

    voice.setRate(1.5);
    await voice.speak("hello", signal);

    expect(elements.map((element) => element.playbackRate)).toEqual([1.5]);
    expect(rates).toEqual([1.5]);
  });

  it("changes the speed and volume of audio that is already playing", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio-bytes"));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:audio", revokeObjectURL: vi.fn() });
    const elements: { playbackRate: number; volume: number }[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        playbackRate = 1;
        volume = 1;
        pause = vi.fn();
        play = () => new Promise<void>(() => {});
        constructor() {
          elements.push(this);
        }
      },
    );
    const { speaker } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());
    void voice.speak("hello", signal);
    await vi.waitFor(() => expect(elements).toHaveLength(1));

    voice.setRate(0.5);
    voice.setVolume(0.2);
    const lowered = elements[0]?.volume;
    voice.setVolume(1);

    expect(elements[0]?.playbackRate).toBe(0.5);
    expect(lowered).toBe(0.2);
    expect(elements[0]?.volume).toBe(1);
  });

  it("keeps controlling new audio when an old one ends late", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio-bytes"));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:audio", revokeObjectURL: vi.fn() });
    const elements: { volume: number; onended: (() => void) | null }[] = [];
    vi.stubGlobal(
      "Audio",
      class {
        volume = 1;
        onended: (() => void) | null = null;
        pause = vi.fn();
        play = () => new Promise<void>(() => {});
        constructor() {
          elements.push(this);
        }
      },
    );
    const { speaker } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());
    const stopped = new AbortController();
    void voice.speak("one", stopped.signal);
    await vi.waitFor(() => expect(elements).toHaveLength(1));
    stopped.abort();
    void voice.speak("two", signal);
    await vi.waitFor(() => expect(elements).toHaveLength(2));

    elements[0]?.onended?.();
    voice.setVolume(0.2);

    expect(elements[1]?.volume).toBe(0.2);
  });

  it("plays later audio at the volume it was given", async () => {
    vi.stubGlobal("fetch", async () => new Response("audio-bytes"));
    const elements: { playbackRate: number; volume: number }[] = [];
    stubAudio(elements);
    const { speaker } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());

    voice.setVolume(0.2);
    await voice.speak("hello", signal);

    expect(elements.map((element) => element.volume)).toEqual([0.2]);
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

  it("plays preloaded phrases from memory without asking the server again", async () => {
    const fetchStub = vi.fn(async () => new Response("audio-bytes"));
    vi.stubGlobal("fetch", fetchStub);
    const played = stubAudio();
    const { speaker } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());

    voice.preload(["hello", "goodbye"]);
    await voice.speak("hello", signal);
    await voice.speak("hello", signal);

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(played).toHaveLength(2);
    expect(await played[1]?.text()).toBe("audio-bytes");
  });

  it("asks the server again for a phrase whose preload failed", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValue(new Response("audio-bytes"));
    vi.stubGlobal("fetch", fetchStub);
    const played = stubAudio();
    const { speaker } = fallbackSpeaker();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());
    voice.preload(["hello"]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await voice.speak("hello", signal);

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(played).toHaveLength(1);
  });

  it("reports the start only once the audio is fetched and playing", async () => {
    let release: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    stubAudio();
    const { speaker } = fallbackSpeaker();
    const onStart = vi.fn();
    const done = elevenLabsSpeaker("tok", speaker, vi.fn()).speak("hello", signal, onStart);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onStart).not.toHaveBeenCalled();

    release(new Response("audio-bytes"));
    await done;

    expect(onStart).toHaveBeenCalledOnce();
  });

  it("resolves at once when aborted while a preloaded phrase is still being fetched", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const played = stubAudio();
    const { speaker, spoken } = fallbackSpeaker();
    const onStart = vi.fn();
    const voice = elevenLabsSpeaker("tok", speaker, vi.fn());
    voice.preload(["hello"]);
    const controller = new AbortController();
    const done = voice.speak("hello", controller.signal, onStart);

    controller.abort();

    await expect(done).resolves.toBeUndefined();
    expect(played).toEqual([]);
    expect(spoken).toEqual([]);
    expect(onStart).not.toHaveBeenCalled();
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

  it("plays a prefetched sentence without asking the server again", async () => {
    const fetchStub = vi.fn(async () => new Response("audio-bytes"));
    vi.stubGlobal("fetch", fetchStub);
    const played = stubAudio();
    const voice = elevenLabsSpeaker("tok", fallbackSpeaker().speaker, vi.fn());

    voice.prefetch("next sentence");
    expect(fetchStub).toHaveBeenCalledOnce();
    await voice.speak("next sentence", signal);

    expect(fetchStub).toHaveBeenCalledOnce();
    expect(played).toHaveLength(1);
  });

  it("fetches again instead of falling back when a prefetch failed", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 502 }))
      .mockResolvedValue(new Response("audio-bytes"));
    vi.stubGlobal("fetch", fetchStub);
    const played = stubAudio();
    const onFallback = vi.fn();
    const voice = elevenLabsSpeaker("tok", fallbackSpeaker().speaker, onFallback);
    voice.prefetch("next sentence");
    await new Promise((resolve) => setTimeout(resolve, 20));

    await voice.speak("next sentence", signal);

    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(played).toHaveLength(1);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
