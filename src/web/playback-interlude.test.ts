import { describe, expect, it, vi } from "vitest";
import { createPlayback, type InterludeHook } from "./playback.ts";
import { controlledSpeaker, oneStep, steps } from "./playback-helpers.ts";

function setup(interlude: InterludeHook) {
  const fake = controlledSpeaker();
  const ended = vi.fn();
  const playback = createPlayback(fake.speaker, {
    steps: () => steps,
    ready: () => Promise.resolve(),
    closing: () => undefined,
    onLead: vi.fn(),
    onStart: vi.fn(),
    onEnd: ended,
    interlude,
  });
  return { ...fake, playback, ended };
}

async function finishNext(fake: ReturnType<typeof controlledSpeaker>, text: string) {
  await vi.waitFor(() => expect(fake.spoken.at(-1)).toBe(text));
  fake.finishLast();
}

describe("createPlayback interlude", () => {
  it("speaks the prompt before the first segment of a step, waits for the reply, then speaks the feedback", async () => {
    const reply = Promise.withResolvers<string | undefined>();
    const { playback, spoken, ...fake } = setup((at, when) =>
      at.step === 0 && when === "before" ? { prompt: "Predict.", reply: reply.promise } : undefined,
    );
    playback.play({ step: 0, segment: 0 });

    await finishNext({ ...fake, spoken }, "Predict.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spoken).toEqual(["Predict."]);

    reply.resolve("Good guess.");
    await finishNext({ ...fake, spoken }, "Good guess.");
    await finishNext({ ...fake, spoken }, "one");

    expect(spoken).toEqual(["Predict.", "Good guess.", "one"]);
  });

  it("goes straight on to the narration when the reply has no feedback", async () => {
    const { playback, spoken, ...fake } = setup((_at, when) =>
      when === "before" ? { prompt: "Predict.", reply: Promise.resolve(undefined) } : undefined,
    );
    playback.play({ step: 0, segment: 0 });

    await finishNext({ ...fake, spoken }, "Predict.");
    await finishNext({ ...fake, spoken }, "one");

    expect(spoken).toEqual(["Predict.", "one"]);
  });

  it("asks only at the first segment of a step, so playing from the middle skips the prompt", async () => {
    const asked: string[] = [];
    const { playback, spoken, ...fake } = setup((at, when) => {
      asked.push(`${at.step}.${at.segment}.${when}`);
      return undefined;
    });
    playback.play({ step: 0, segment: 1 });

    await finishNext({ ...fake, spoken }, "two");
    await finishNext({ ...fake, spoken }, "three");

    expect(asked.filter((entry) => entry.endsWith("before"))).toEqual(["1.0.before"]);
  });

  it("asks after the last segment of a step, before the next step starts", async () => {
    const { playback, spoken, ...fake } = setup((at, when) =>
      at.step === 0 && when === "after"
        ? { prompt: "Click.", reply: Promise.resolve("Right.") }
        : undefined,
    );
    playback.play({ step: 0, segment: 0 });

    await finishNext({ ...fake, spoken }, "one");
    await finishNext({ ...fake, spoken }, "two");
    await finishNext({ ...fake, spoken }, "Click.");
    await finishNext({ ...fake, spoken }, "Right.");
    await finishNext({ ...fake, spoken }, "three");

    expect(spoken).toEqual(["one", "two", "Click.", "Right.", "three"]);
  });

  it("plays a step that streamed in while the reply after the last step was pending", async () => {
    const fake = controlledSpeaker();
    const streamed = [oneStep("one")];
    const reply = Promise.withResolvers<string | undefined>();
    const ended = vi.fn();
    const playback = createPlayback(fake.speaker, {
      steps: () => streamed,
      ready: () => Promise.resolve(),
      closing: () => undefined,
      onLead: vi.fn(),
      onStart: vi.fn(),
      onEnd: ended,
      interlude: (at, when) =>
        at.step === 0 && when === "after" ? { prompt: "Click.", reply: reply.promise } : undefined,
    });
    playback.play({ step: 0, segment: 0 });

    await finishNext(fake, "one");
    await finishNext(fake, "Click.");
    streamed.push(oneStep("two"));
    reply.resolve(undefined);
    await finishNext(fake, "two");

    expect(fake.spoken).toEqual(["one", "Click.", "two"]);
    await vi.waitFor(() => expect(ended).toHaveBeenCalled());
  });

  it("stops waiting for the reply when playback is stopped, and speaks nothing more", async () => {
    let received: AbortSignal | undefined;
    const { playback, spoken, ended, ...fake } = setup((at, when, signal) => {
      if (at.step !== 0 || when !== "before") return undefined;
      received = signal;
      return {
        prompt: "Predict.",
        reply: new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined))),
      };
    });
    playback.play({ step: 0, segment: 0 });
    await finishNext({ ...fake, spoken }, "Predict.");
    await vi.waitFor(() => expect(received).toBeDefined());

    expect(playback.stop()).toEqual({ step: 0, segment: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received?.aborted).toBe(true);
    expect(spoken).toEqual(["Predict."]);
    expect(ended).not.toHaveBeenCalled();
  });
});
