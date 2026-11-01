import { describe, expect, it, vi } from "vitest";
import { createPlayback } from "./playback.ts";
import { stepIn } from "./playback-helpers.ts";
import type { Speaker } from "./speaker.ts";

const steps = [stepIn("a.ts", "one", "two"), stepIn("b.ts", "three")];

function setup() {
  const events: { name: string; at: number }[] = [];
  const finishers: (() => void)[] = [];
  const speaker: Speaker = {
    speak: (text, signal, onStart) =>
      new Promise<void>((resolve) => {
        events.push({ name: `speak ${text}`, at: performance.now() });
        finishers.push(resolve);
        signal.addEventListener("abort", () => resolve());
        onStart?.();
      }),
  };
  const playback = createPlayback(speaker, {
    steps: () => steps,
    ready: () => Promise.resolve(),
    closing: () => undefined,
    onLead: (position) =>
      events.push({ name: `lead ${position.step}.${position.segment}`, at: performance.now() }),
    onStart: vi.fn(),
    onEnd: vi.fn(),
  });
  return { events, playback, finishLast: () => finishers.at(-1)?.() };
}

describe("playback scroll lead", () => {
  it("moves the viewer to the next file 200 ms before that segment's audio starts", async () => {
    const { events, playback, finishLast } = setup();

    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    finishLast();
    await vi.waitFor(() => expect(events).toHaveLength(2));
    finishLast();
    await vi.waitFor(() => expect(events).toHaveLength(4));

    expect(events.map((event) => event.name)).toEqual([
      "speak one",
      "speak two",
      "lead 1.0",
      "speak three",
    ]);
    const lead = (events[3]?.at ?? 0) - (events[2]?.at ?? 0);
    expect(lead).toBeGreaterThanOrEqual(190);
    expect(lead).toBeLessThan(400);
  });

  it("does not wait when the next segment is in the same file", async () => {
    const { events, playback, finishLast } = setup();

    playback.play({ step: 0, segment: 0 });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    finishLast();
    await vi.waitFor(() => expect(events).toHaveLength(2));

    expect(events.map((event) => event.name)).toEqual(["speak one", "speak two"]);
    expect((events[1]?.at ?? 0) - (events[0]?.at ?? 0)).toBeLessThan(100);
  });

  it("has no lead for the first segment of a run, even in another file", async () => {
    const { events, playback } = setup();
    const startedAt = performance.now();

    playback.play({ step: 1, segment: 0 });
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events.map((event) => event.name)).toEqual(["speak three"]);
    expect((events[0]?.at ?? 0) - startedAt).toBeLessThan(100);
  });

  it("speaks nothing when stopped during the lead", async () => {
    const { events, playback, finishLast } = setup();
    playback.play({ step: 0, segment: 1 });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    finishLast();
    await vi.waitFor(() => expect(events).toHaveLength(2));

    expect(playback.stop()).toEqual({ step: 1, segment: 0 });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events.map((event) => event.name)).toEqual(["speak two", "lead 1.0"]);
  });
});
