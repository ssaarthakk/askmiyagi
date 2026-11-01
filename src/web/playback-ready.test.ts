import { describe, expect, it, vi } from "vitest";
import { createPlayback } from "./playback.ts";
import { controlledSpeaker, steps } from "./playback-helpers.ts";

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
      closing: () => undefined,
      onLead: vi.fn(),
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
