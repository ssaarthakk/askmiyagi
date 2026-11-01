import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstSound } from "./first-sound.ts";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const report = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue();
  return { report, firstSound: createFirstSound(report) };
}

describe("createFirstSound", () => {
  it("reports the time from the question to the first sound once the answer has finished", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    vi.advanceTimersByTime(850);
    firstSound.started();
    expect(report).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    firstSound.answered();

    expect(report).toHaveBeenCalledExactlyOnceWith(850);
  });

  it("reports at the first sound when the answer finished earlier", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    firstSound.answered();
    vi.advanceTimersByTime(1200);

    firstSound.started();

    expect(report).toHaveBeenCalledExactlyOnceWith(1200);
  });

  it("counts only the first sound of a question", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    vi.advanceTimersByTime(300);
    firstSound.started();
    vi.advanceTimersByTime(300);
    firstSound.started();
    firstSound.answered();
    firstSound.started();

    expect(report).toHaveBeenCalledExactlyOnceWith(300);
  });

  it("reports nothing when the answer finished without any sound", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    firstSound.answered();

    expect(report).not.toHaveBeenCalled();
  });

  it("reports nothing for sound that was not started by a question", () => {
    const { report, firstSound } = setup();

    firstSound.started();
    firstSound.answered();

    expect(report).not.toHaveBeenCalled();
  });

  it("starts again when a new question is asked", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    firstSound.started();
    firstSound.asked();
    vi.advanceTimersByTime(400);
    firstSound.started();
    firstSound.answered();

    expect(report).toHaveBeenLastCalledWith(400);
  });

  it("reports nothing when playback was paused before the first sound", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    firstSound.cancel();
    vi.advanceTimersByTime(60_000);
    firstSound.started();
    firstSound.answered();

    expect(report).not.toHaveBeenCalled();
  });

  it("keeps the time when playback was paused after the first sound", () => {
    const { report, firstSound } = setup();
    firstSound.asked();
    vi.advanceTimersByTime(700);
    firstSound.started();
    firstSound.cancel();
    firstSound.answered();

    expect(report).toHaveBeenCalledExactlyOnceWith(700);
  });
});
