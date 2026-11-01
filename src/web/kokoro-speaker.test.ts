import { afterEach, describe, expect, it, vi } from "vitest";
import { ackPhrases } from "../shared/phrases.ts";
import { kokoroSpeaker, noLocalVoice, type Speaker } from "./speaker.ts";
import { fallbackSpeaker, stubAudio } from "./speaker-helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kokoroSpeaker", () => {
  const signal = new AbortController().signal;

  function fakeEngine(ready: Promise<void>) {
    const run = vi.fn(
      async (text: string, _transfer?: Transferable[], _signal?: AbortSignal) =>
        new Blob([`wav:${text}`]),
    );
    return { ready, stopped: false, run };
  }

  function noBrowserVoice(): Speaker {
    return {
      speak: async () => {
        throw new Error(noLocalVoice);
      },
    };
  }

  function signalFor(engine: ReturnType<typeof fakeEngine>, text: string) {
    return engine.run.mock.calls.find(([called]) => called === text)?.[2];
  }

  it("speaks with the fallback voice while the model downloads", async () => {
    const engine = fakeEngine(new Promise(() => {}));
    const { speaker, spoken } = fallbackSpeaker();
    const notify = vi.fn();

    await kokoroSpeaker(engine, speaker, notify).speak("hello", signal);

    expect(spoken).toEqual(["hello"]);
    expect(engine.run).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("plays the local voice once the model is ready, with the acknowledgement phrases made at once", async () => {
    const engine = fakeEngine(Promise.resolve());
    const played = stubAudio();
    const { speaker, spoken } = fallbackSpeaker();
    const notify = vi.fn();
    const voice = kokoroSpeaker(engine, speaker, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("Local voice ready"));

    await voice.speak("hello", signal);

    expect(engine.run.mock.calls.map(([text]) => text)).toEqual([...ackPhrases, "hello"]);
    expect(await played[0]?.text()).toBe("wav:hello");
    expect(spoken).toEqual([]);
  });

  it("stays on the fallback voice with a notice when the model cannot load", async () => {
    const engine = fakeEngine(Promise.reject(new Error("no network")));
    const { speaker, spoken } = fallbackSpeaker();
    const notify = vi.fn();
    const voice = kokoroSpeaker(engine, speaker, notify);
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Local voice failed to load, using the browser voice"),
    );

    await voice.speak("hello", signal);

    expect(spoken).toEqual(["hello"]);
    expect(engine.run).not.toHaveBeenCalled();
  });

  it("waits for the model and then speaks with it when there is no browser voice", async () => {
    let finishLoading: () => void = () => {};
    const engine = fakeEngine(
      new Promise<void>((resolve) => {
        finishLoading = resolve;
      }),
    );
    const played = stubAudio();
    const onStart = vi.fn();
    const spoken = kokoroSpeaker(engine, noBrowserVoice(), vi.fn()).speak("hello", signal, onStart);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onStart).not.toHaveBeenCalled();

    finishLoading();
    await spoken;

    expect(await played.at(-1)?.text()).toBe("wav:hello");
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows text when there is no browser voice and the model cannot load", async () => {
    const engine = fakeEngine(Promise.reject(new Error("no network")));

    const spoken = kokoroSpeaker(engine, noBrowserVoice(), vi.fn()).speak("hello", signal);

    await expect(spoken).rejects.toThrow(noLocalVoice);
  });

  it("stops waiting for the model when the segment is stopped", async () => {
    const engine = fakeEngine(new Promise(() => {}));
    const controller = new AbortController();
    const spoken = kokoroSpeaker(engine, noBrowserVoice(), vi.fn()).speak(
      "hello",
      controller.signal,
    );

    controller.abort();

    await expect(spoken).resolves.toBeUndefined();
    expect(engine.run).not.toHaveBeenCalled();
  });

  it("cancels the model request of a segment that is stopped", async () => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(() => new Promise<Blob>(() => {}));
    const voice = kokoroSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;
    const controller = new AbortController();
    const spoken = voice.speak("hello", controller.signal);
    await vi.waitFor(() => expect(signalFor(engine, "hello")).toBeDefined());

    controller.abort();

    await expect(spoken).resolves.toBeUndefined();
    expect(signalFor(engine, "hello")?.aborted).toBe(true);
  });

  it("cancels a prefetched sentence that is no longer next when another one is spoken", async () => {
    const engine = fakeEngine(Promise.resolve());
    stubAudio();
    const voice = kokoroSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;

    voice.prefetch?.("old next sentence");
    await voice.speak("new answer", signal);

    expect(signalFor(engine, "old next sentence")?.aborted).toBe(true);
    expect(signalFor(engine, "new answer")?.aborted).toBe(false);
  });
});
