import { describe, expect, it, vi } from "vitest";
import { createPlayback } from "./playback.ts";
import type { PlayerStep } from "./player.ts";
import type { Speaker } from "./speaker.ts";

function oneStep(...texts: string[]): PlayerStep {
  return {
    step: {
      title: "Step",
      anchors: [{ file: "a.ts", symbol: "A" }],
      narration: texts.map((text) => ({ text })),
    },
    ranges: [null],
  };
}

const steps = [oneStep("one", "two"), oneStep("three")];

function controlledSpeaker() {
  const spoken: string[] = [];
  const signals: AbortSignal[] = [];
  const finishers: (() => void)[] = [];
  const failers: ((error: Error) => void)[] = [];
  const speaker: Speaker = {
    speak: (text, signal, onStart) =>
      new Promise<void>((resolve, reject) => {
        onStart?.();
        spoken.push(text);
        signals.push(signal);
        finishers.push(resolve);
        failers.push(reject);
      }),
  };
  return {
    speaker,
    spoken,
    signals,
    finishLast: () => finishers.at(-1)?.(),
    failLast: (error: Error) => failers.at(-1)?.(error),
  };
}

function setup(list = steps) {
  const fake = controlledSpeaker();
  const started: { step: number; segment: number }[] = [];
  const onEnd = vi.fn();
  const playback = createPlayback(fake.speaker, {
    steps: () => list,
    ready: () => Promise.resolve(),
    onStart: (position) => started.push(position),
    onEnd,
  });
  return { ...fake, started, onEnd, playback };
}

describe("createPlayback", () => {
  it("speaks segments in order across steps and ends after the last", async () => {
    const { playback, spoken, finishLast, started, onEnd } = setup();

    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toEqual(["one"]));
    finishLast();
    await vi.waitFor(() => expect(spoken).toEqual(["one", "two"]));
    finishLast();
    await vi.waitFor(() => expect(spoken).toEqual(["one", "two", "three"]));
    expect(onEnd).not.toHaveBeenCalled();
    finishLast();

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(onEnd).toHaveBeenCalledWith();
    expect(started).toEqual([
      { step: 0, segment: 0 },
      { step: 0, segment: 1 },
      { step: 1, segment: 0 },
    ]);
  });

  function silentSpeaker() {
    const starts: (() => void)[] = [];
    const speaker: Speaker = {
      speak: (_text, _signal, onStart) =>
        new Promise<void>(() => {
          if (onStart) starts.push(onStart);
        }),
    };
    return { speaker, starts };
  }

  it("reports a segment only when the speaker says its audio started", async () => {
    const { speaker, starts } = silentSpeaker();
    const started: { step: number; segment: number }[] = [];
    const playback = createPlayback(speaker, {
      steps: () => steps,
      ready: () => Promise.resolve(),
      onStart: (position) => started.push(position),
      onEnd: vi.fn(),
    });

    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(starts).toHaveLength(1));
    expect(started).toEqual([]);
    starts[0]?.();

    expect(started).toEqual([{ step: 0, segment: 0 }]);
  });

  it("does not report a start that arrives after stop", async () => {
    const { speaker, starts } = silentSpeaker();
    const onStart = vi.fn();
    const playback = createPlayback(speaker, {
      steps: () => steps,
      ready: () => Promise.resolve(),
      onStart,
      onEnd: vi.fn(),
    });
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(starts).toHaveLength(1));

    playback.stop();
    starts[0]?.();

    expect(onStart).not.toHaveBeenCalled();
  });

  it("plays from a chosen segment onward", async () => {
    const { playback, spoken, finishLast } = setup();

    playback.play({ step: 0, segment: 1 });
    await vi.waitFor(() => expect(spoken).toEqual(["two"]));
    finishLast();

    await vi.waitFor(() => expect(spoken).toEqual(["two", "three"]));
  });

  it("stop aborts the audio and never moves on or reports an end", async () => {
    const { playback, spoken, signals, finishLast, onEnd } = setup();
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    playback.stop();
    finishLast();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(signals[0]?.aborted).toBe(true);
    expect(spoken).toEqual(["one"]);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("stop gives the segment it interrupted, even before its audio started", async () => {
    const { playback, spoken, finishLast } = setup();
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toEqual(["one"]));
    finishLast();
    await vi.waitFor(() => expect(spoken).toEqual(["one", "two"]));

    expect(playback.stop()).toEqual({ step: 0, segment: 1 });
    expect(playback.stop()).toBeUndefined();
  });

  it("stop gives nothing once playback has ended", async () => {
    const { playback, spoken, finishLast, onEnd } = setup([oneStep("one")]);
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toEqual(["one"]));
    finishLast();
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalled());

    expect(playback.stop()).toBeUndefined();
  });

  it("playing again cuts off the old run and continues from the new segment", async () => {
    const { playback, spoken, signals, finishLast, onEnd } = setup();
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    playback.play({ step: 1, segment: 0 });
    await vi.waitFor(() => expect(spoken).toEqual(["one", "three"]));
    expect(signals[0]?.aborted).toBe(true);
    finishLast();

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
    expect(spoken).toEqual(["one", "three"]);
  });

  it("reads steps afresh so segments that arrive later are spoken", async () => {
    const list = [oneStep("one")];
    const { playback, spoken, finishLast } = setup(list);
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    list.push(oneStep("later"));
    finishLast();

    await vi.waitFor(() => expect(spoken).toEqual(["one", "later"]));
  });

  it("reports the speaker's error and stops", async () => {
    const { playback, spoken, failLast, onEnd } = setup();
    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));

    failLast(new Error("no voice"));

    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledWith(new Error("no voice")));
    expect(spoken).toEqual(["one"]);
  });
});

describe("createPlayback ready", () => {
  function setupReady() {
    const fake = controlledSpeaker();
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: { step: number; segment: number }[] = [];
    const playback = createPlayback(fake.speaker, {
      steps: () => steps,
      ready: () => ready,
      onStart: (position) => started.push(position),
      onEnd: vi.fn(),
    });
    return { ...fake, started, playback, release };
  }

  it("stop while waiting gives the segment it was asked to play", async () => {
    const { playback } = setupReady();

    playback.play({ step: 1, segment: 0 });

    expect(playback.stop()).toEqual({ step: 1, segment: 0 });
  });

  it("waits until ready before starting the first segment", async () => {
    const { playback, spoken, started, release } = setupReady();

    playback.play({ step: 0, segment: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spoken).toEqual([]);
    expect(started).toEqual([]);
    release();
    await vi.waitFor(() => expect(spoken).toEqual(["one"]));
    expect(started).toEqual([{ step: 0, segment: 0 }]);
  });

  it("speaks nothing when stopped while waiting", async () => {
    const { playback, spoken, release } = setupReady();
    playback.play({ step: 0, segment: 0 });

    playback.stop();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spoken).toEqual([]);
  });
});
