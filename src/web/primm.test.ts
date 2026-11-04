import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAnchor } from "../shared/anchor.ts";
import type { Step } from "../shared/tour.ts";
import type { PlayerStep } from "./player.ts";
import { postPrediction } from "./predict.ts";
import { createPrimm } from "./primm.svelte.ts";

vi.mock("./predict.ts", () => ({ postPrediction: vi.fn() }));

const target: ResolvedAnchor = { file: "a.ts", start: 5, end: 7, capped: false };
const at = { step: 1, segment: 0 };

function stepWith(primm: boolean): Step {
  return {
    title: "Step",
    anchors: [{ file: "a.ts", symbol: "A" }],
    narration: [{ text: "one", anchor: 0 }],
    ...(primm && {
      primm: {
        predict: "What happens on failure?",
        investigate: "Click the line that saves.",
        target: { file: "a.ts", line: 5, text: "save();" },
      },
    }),
  };
}

function entry(primm: boolean, range: ResolvedAnchor | null = target): PlayerStep {
  return { step: stepWith(primm), ranges: [null, range] };
}

function setup(steps: PlayerStep[] = [entry(false), entry(true)]) {
  const shown: unknown[] = [];
  const told: string[] = [];
  const tour = { question: "How are clips saved?" };
  const primm = createPrimm({
    token: "t",
    tour: () => tour.question,
    steps: () => steps,
    show: (position) => shown.push(position),
    showFile: (file, range) => shown.push({ file, range }),
    tell: (text) => told.push(text),
  });
  return { primm, shown, told, tour };
}

const never = new AbortController().signal;

beforeEach(() => {
  vi.mocked(postPrediction).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("createPrimm predict", () => {
  it("does nothing for a step without primm", () => {
    const { primm } = setup();

    expect(primm.interlude({ step: 0, segment: 0 }, "before", never)).toBeUndefined();
    expect(primm.interlude({ step: 0, segment: 0 }, "after", never)).toBeUndefined();
  });

  it("shows the step's code, tells the learner the prompt and waits for a prediction", async () => {
    vi.mocked(postPrediction).mockResolvedValue("Close, it retries.");
    const { primm, shown, told } = setup();

    const turn = primm.interlude(at, "before", never);

    expect(turn?.prompt).toBe("What happens on failure?");
    expect(shown).toEqual([at]);
    expect(told).toEqual(["What happens on failure?"]);
    expect(primm.view).toEqual({ phase: "predict", prompt: "What happens on failure?" });
    expect(primm.predicting).toBe(true);

    const reply = turn?.reply;
    primm.predict("It retries");

    expect(await reply).toBe("Close, it retries.");
    expect(postPrediction).toHaveBeenCalledWith("How are clips saved?", 1, "It retries", "t");
    expect(told.at(-1)).toBe("Close, it retries.");
    expect(primm.view).toBeUndefined();
    expect(primm.predicting).toBe(false);
  });

  it("gives no feedback when the learner skips, and asks only once", async () => {
    const { primm } = setup();
    const reply = primm.interlude(at, "before", never)?.reply;

    primm.skip();

    expect(await reply).toBeUndefined();
    expect(postPrediction).not.toHaveBeenCalled();
    expect(primm.interlude(at, "before", never)).toBeUndefined();
  });

  it("carries on without feedback when the check fails", async () => {
    vi.mocked(postPrediction).mockRejectedValue(new Error("Rate limited"));
    const { primm } = setup();
    const reply = primm.interlude(at, "before", never)?.reply;

    primm.predict("It retries");

    expect(await reply).toBeUndefined();
  });

  it("clears the prompt when playback stops, and asks again next time", async () => {
    const { primm } = setup();
    const controller = new AbortController();
    const reply = primm.interlude(at, "before", controller.signal)?.reply;

    controller.abort();

    expect(await reply).toBeUndefined();
    expect(primm.view).toBeUndefined();
    expect(primm.interlude(at, "before", never)).toBeDefined();
  });

  it("asks again after reset", async () => {
    const { primm } = setup();
    const reply = primm.interlude(at, "before", never)?.reply;
    primm.skip();
    await reply;

    primm.reset();

    expect(primm.interlude(at, "before", never)).toBeDefined();
  });

  it("does not ask an earlier tour again after a side question resets for its own tour", async () => {
    const { primm, tour } = setup();
    const reply = primm.interlude(at, "before", never)?.reply;
    primm.predict("It retries");
    await reply;

    tour.question = "What is a clip?";
    primm.reset();
    tour.question = "How are clips saved?";

    expect(primm.interlude(at, "before", never)).toBeUndefined();
  });

  it("ignores a prediction or a skip when nothing is waiting", () => {
    const { primm } = setup();

    primm.predict("x");
    primm.skip();

    expect(postPrediction).not.toHaveBeenCalled();
  });
});

describe("createPrimm investigate", () => {
  function waiting(steps?: PlayerStep[]) {
    const made = setup(steps);
    const turn = made.primm.interlude(at, "after", never);
    return { ...made, turn, reply: turn?.reply };
  }

  it("hides the highlight and waits for a click", () => {
    const { primm, shown, turn, told } = waiting();

    expect(turn?.prompt).toBe("Click the line that saves.");
    expect(shown).toEqual([{ file: "a.ts", range: null }]);
    expect(told).toEqual(["Click the line that saves."]);
    expect(primm.view).toEqual({ phase: "investigate", prompt: "Click the line that saves." });
    expect(primm.predicting).toBe(false);
  });

  it("says it is right for a click inside the target's lines, and highlights them", async () => {
    const { primm, shown, reply, told } = waiting();

    primm.clicked("a.ts", 6);

    expect(await reply).toBe("That's right.");
    expect(shown.at(-1)).toEqual({ file: "a.ts", range: target });
    expect(told.at(-1)).toBe("That's right.");
    expect(primm.view).toBeUndefined();
  });

  it("counts the first and last line of the target as inside", async () => {
    for (const line of [5, 7]) {
      const { primm, reply } = waiting();
      primm.clicked("a.ts", line);
      expect(await reply).toBe("That's right.");
    }
  });

  it("says it is not quite right for a click on another line or in another file, and shows where it is", async () => {
    for (const [file, line] of [
      ["a.ts", 4],
      ["a.ts", 8],
      ["b.ts", 6],
    ] as const) {
      const { primm, shown, reply } = waiting();
      primm.clicked(file, line);
      expect(await reply).toBe("Not quite, it's here.");
      expect(shown.at(-1)).toEqual({ file: "a.ts", range: target });
    }
  });

  it("gives nothing to investigate when the target did not resolve", () => {
    expect(
      setup([entry(false), entry(true, null)]).primm.interlude(at, "after", never),
    ).toBeUndefined();
  });

  it("gives nothing to investigate in a diff tour", () => {
    const diffStep = { ...entry(true), base: "uncommitted" as const };

    expect(setup([entry(false), diffStep]).primm.interlude(at, "after", never)).toBeUndefined();
  });

  it("lets the learner skip, and asks only once", async () => {
    const { primm, reply } = waiting();

    primm.skip();

    expect(await reply).toBeUndefined();
    expect(primm.interlude(at, "after", never)).toBeUndefined();
  });

  it("ignores a click when no investigation is waiting", () => {
    const { primm, shown } = setup();

    primm.clicked("a.ts", 6);

    expect(shown).toEqual([]);
  });
});
