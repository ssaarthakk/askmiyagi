import { describe, expect, it, vi } from "vitest";
import { createAnnouncer, spokenProgress } from "./announcer.ts";
import type { Speaker } from "./speaker.ts";

function controlledSpeaker() {
  const spoken: string[] = [];
  const signals: AbortSignal[] = [];
  const finishers: (() => void)[] = [];
  const failers: ((error: Error) => void)[] = [];
  const speaker: Speaker = {
    speak: (text, signal) =>
      new Promise<void>((resolve, reject) => {
        spoken.push(text);
        signals.push(signal);
        finishers.push(resolve);
        failers.push(reject);
        signal.addEventListener("abort", () => resolve(), { once: true });
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

function setup() {
  const fake = controlledSpeaker();
  const onError = vi.fn();
  return { ...fake, onError, announcer: createAnnouncer(fake.speaker, onError) };
}

describe("createAnnouncer", () => {
  it("starts speaking at once and says one line at a time, in order", async () => {
    const { announcer, spoken, finishLast } = setup();

    announcer.say("one");
    announcer.say("two");

    expect(spoken).toEqual(["one"]);
    finishLast();
    await vi.waitFor(() => expect(spoken).toEqual(["one", "two"]));
  });

  it("drops the lines still waiting but lets the one being spoken finish", async () => {
    const { announcer, spoken, signals, finishLast } = setup();
    announcer.say("one");
    announcer.say("two");
    announcer.say("three");

    announcer.dropWaiting();

    expect(signals[0]?.aborted).toBe(false);
    finishLast();
    await announcer.finished();
    expect(spoken).toEqual(["one"]);
  });

  it("finished resolves only after the line being spoken ends", async () => {
    const { announcer, finishLast } = setup();
    announcer.say("one");
    let done = false;
    void announcer.finished().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);

    finishLast();

    await vi.waitFor(() => expect(done).toBe(true));
  });

  it("finished resolves at once when nothing is being said", async () => {
    const { announcer } = setup();

    await announcer.finished();
  });

  it("stop aborts the line being spoken and drops the waiting ones", async () => {
    const { announcer, spoken, signals } = setup();
    announcer.say("one");
    announcer.say("two");

    announcer.stop();

    expect(signals[0]?.aborted).toBe(true);
    await announcer.finished();
    expect(spoken).toEqual(["one"]);
  });

  it("speaks lines said after a stop", async () => {
    const { announcer, spoken, signals } = setup();
    announcer.say("one");
    announcer.stop();
    await announcer.finished();

    announcer.say("two");

    expect(spoken).toEqual(["one", "two"]);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("reports a speech error and drops the waiting lines", async () => {
    const { announcer, spoken, failLast, onError } = setup();
    announcer.say("one");
    announcer.say("two");

    failLast(new Error("no voice"));

    await announcer.finished();
    expect(onError).toHaveBeenCalledWith(new Error("no voice"));
    expect(spoken).toEqual(["one"]);
  });
});

describe("spokenProgress", () => {
  it("speaks the first file like a person, without the extension", () => {
    expect(spokenProgress("Looking at upload.ts", 0)).toBe("Let me look at upload.");
    expect(spokenProgress("Looking at clip.test.tsx", 0)).toBe("Let me look at clip test.");
  });

  it("says the second one briefly and stays quiet after that", () => {
    expect(spokenProgress("Looking at ask-route.ts", 1)).toBe("Now ask route.");
    expect(spokenProgress("Looking at cli.ts", 2)).toBeUndefined();
  });

  it("splits camel case and snake case names into words", () => {
    expect(spokenProgress("Looking at claudeStream.ts", 0)).toBe("Let me look at claude Stream.");
    expect(spokenProgress("Finding ClipService.save", 0)).toBe("Let me find Clip Service save.");
    expect(spokenProgress("Looking at file_filter.ts", 1)).toBe("Now file filter.");
  });

  it("keeps names without an extension and drops the dot of a dotfile", () => {
    expect(spokenProgress("Looking at Dockerfile", 0)).toBe("Let me look at Dockerfile.");
    expect(spokenProgress("Looking at .gitignore", 0)).toBe("Let me look at gitignore.");
  });

  it("does not read search patterns aloud", () => {
    expect(spokenProgress("Searching for upload.ts or post", 0)).toBeUndefined();
  });

  it("says other notes as they are", () => {
    expect(spokenProgress("Ignoring the selection: line 9 is not in upload.ts", 0)).toBe(
      "Ignoring the selection: line 9 is not in upload.ts",
    );
  });
});
