import { afterEach, describe, expect, it, vi } from "vitest";
import { localSpeaker, type Speaker } from "./speaker.ts";
import { fakeEngine, fallbackSpeaker, signalFor, stubAudio } from "./speaker-helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a local voice part, sentence by sentence", () => {
  const signal = new AbortController().signal;

  it("plays the first sentence while the model is still making the next one", async () => {
    const engine = fakeEngine(Promise.resolve());
    let finishSecond: (audio: Blob) => void = () => {};
    engine.run.mockImplementation(async (text: string) =>
      text === "Second one."
        ? new Promise<Blob>((resolve) => {
            finishSecond = resolve;
          })
        : new Blob([`wav:${text}`]),
    );
    const played = stubAudio();
    const onStart = vi.fn();
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;

    const spoken = voice.speak("First one. Second one.", signal, onStart);
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledOnce());

    expect(await Promise.all(played.map((audio) => audio.text()))).toEqual(["wav:First one."]);
    expect(engine.run.mock.calls.map(([text]) => text)).toContain("Second one.");

    finishSecond(new Blob(["wav:Second one."]));
    await spoken;

    expect(await Promise.all(played.map((audio) => audio.text()))).toEqual([
      "wav:First one.",
      "wav:Second one.",
    ]);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("makes a prefetched part sentence by sentence and does not make it again", async () => {
    const engine = fakeEngine(Promise.resolve());
    const played = stubAudio();
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;
    engine.run.mockClear();

    voice.prefetch?.("Next one. Next two.");
    await voice.speak("Next one. Next two.", signal);

    expect(engine.run.mock.calls.map(([text]) => text)).toEqual(["Next one.", "Next two."]);
    expect(await Promise.all(played.map((audio) => audio.text()))).toEqual([
      "wav:Next one.",
      "wav:Next two.",
    ]);
  });

  it("speaks the rest of the part with the fallback voice when a sentence fails", async () => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(async (text: string) => {
      if (text === "Second one.") throw new Error("model crashed");
      return new Blob([`wav:${text}`]);
    });
    const played = stubAudio();
    const { speaker, spoken } = fallbackSpeaker();
    const notify = vi.fn();
    const voice = localSpeaker(engine, speaker, notify);
    await engine.ready;

    await voice.speak("First one. Second one. Third one.", signal);

    expect(await Promise.all(played.map((audio) => audio.text()))).toEqual(["wav:First one."]);
    expect(spoken).toEqual(["Second one. Third one."]);
    expect(notify).toHaveBeenCalledWith("Local voice failed, using the browser voice");
    expect(signalFor(engine, "Third one.")?.aborted).toBe(true);
  });

  it.each([
    ["the first sentence fails, from the fallback voice", "First one."],
    ["a later sentence fails, from the local voice only", "Second one."],
  ])("reports the start of a part once when %s", async (_case, failing) => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(async (text: string) => {
      if (text === failing) throw new Error("model crashed");
      return new Blob([`wav:${text}`]);
    });
    stubAudio();
    const startingFallback: Speaker = {
      speak: async (_text, _signal, onStart) => onStart?.(),
    };
    const voice = localSpeaker(engine, startingFallback, vi.fn());
    await engine.ready;
    const onStart = vi.fn();

    await voice.speak("First one. Second one.", signal, onStart);

    expect(onStart).toHaveBeenCalledOnce();
  });

  it("cancels a failed prefetch's other sentences", async () => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(async (text: string) => {
      if (text === "Next one.") throw new Error("model crashed");
      return new Promise<Blob>(() => {});
    });
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;

    voice.prefetch?.("Next one. Next two.");

    await vi.waitFor(() => expect(signalFor(engine, "Next two.")?.aborted).toBe(true));
  });

  it("cancels the sentences not yet made when the part is stopped", async () => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(() => new Promise<Blob>(() => {}));
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;
    const controller = new AbortController();
    const spoken = voice.speak("First one. Second one.", controller.signal);
    await vi.waitFor(() => expect(signalFor(engine, "Second one.")).toBeDefined());

    controller.abort();

    await expect(spoken).resolves.toBeUndefined();
    expect(signalFor(engine, "First one.")?.aborted).toBe(true);
    expect(signalFor(engine, "Second one.")?.aborted).toBe(true);
  });

  it("cancels a prefetched part when it is stopped while being spoken", async () => {
    const engine = fakeEngine(Promise.resolve());
    engine.run.mockImplementation(() => new Promise<Blob>(() => {}));
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;
    const controller = new AbortController();

    voice.prefetch?.("Next one. Next two.");
    const spoken = voice.speak("Next one. Next two.", controller.signal);
    controller.abort();

    await expect(spoken).resolves.toBeUndefined();
    expect(signalFor(engine, "Next two.")?.aborted).toBe(true);
  });

  it("cancels a prefetched sentence that is no longer next when another one is spoken", async () => {
    const engine = fakeEngine(Promise.resolve());
    const played = stubAudio();
    const voice = localSpeaker(engine, fallbackSpeaker().speaker, vi.fn());
    await engine.ready;

    voice.prefetch?.("old next sentence");
    await voice.speak("new answer", signal);

    expect(signalFor(engine, "old next sentence")?.aborted).toBe(true);
    expect(await Promise.all(played.map((audio) => audio.text()))).toEqual(["wav:new answer"]);
  });
});
