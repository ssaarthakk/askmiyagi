import type { ResolvedAnchor } from "../shared/anchor.ts";
import type { InterludeHook } from "./playback.ts";
import type { PlayerStep, Position } from "./player.ts";
import { postPrediction } from "./predict.ts";

export type PrimmView = { phase: "predict" | "investigate"; prompt: string };

const rightAnswer = "That's right.";
const wrongAnswer = "Not quite, it's here.";

export function createPrimm(options: {
  token: string;
  tour: () => string;
  steps: () => PlayerStep[];
  show: (position: Position) => void;
  showFile: (file: string, range: ResolvedAnchor | null) => void;
  tell: (text: string) => void;
}) {
  let view = $state<PrimmView>();
  let settle: ((value: string | undefined) => void) | undefined;
  let target: ResolvedAnchor | undefined;
  const done = new Map<string, Set<string>>();

  function wait(
    phase: PrimmView["phase"],
    prompt: string,
    markDone: () => void,
    signal: AbortSignal,
  ) {
    return new Promise<string | undefined>((resolve) => {
      const clear = () => {
        view = undefined;
        settle = undefined;
        target = undefined;
      };
      const stop = () => {
        clear();
        resolve(undefined);
      };
      signal.addEventListener("abort", stop, { once: true });
      settle = (value) => {
        signal.removeEventListener("abort", stop);
        markDone();
        clear();
        resolve(value);
      };
      view = { phase, prompt };
    });
  }

  async function feedbackFor(step: number, prediction: string | undefined) {
    if (prediction === undefined) return undefined;
    try {
      const feedback = await postPrediction(options.tour(), step, prediction, options.token);
      options.tell(feedback);
      return feedback;
    } catch (error) {
      console.warn("Could not check the prediction", error);
      return undefined;
    }
  }

  const interlude: InterludeHook = (at, when, signal) => {
    const entry = options.steps()[at.step];
    const primm = entry?.step.primm;
    const tour = options.tour();
    const key = `${at.step}:${when}`;
    if (!entry || !primm || done.get(tour)?.has(key)) return undefined;
    const markDone = () => done.set(tour, (done.get(tour) ?? new Set()).add(key));
    if (when === "before") {
      options.show(at);
      options.tell(primm.predict);
      const feedback = wait("predict", primm.predict, markDone, signal).then((prediction) =>
        feedbackFor(at.step, prediction),
      );
      return { prompt: primm.predict, reply: feedback };
    }
    const range = entry.ranges[entry.step.anchors.length];
    if (!range || entry.base) return undefined;
    options.showFile(range.file, null);
    options.tell(primm.investigate);
    const click = wait("investigate", primm.investigate, markDone, signal);
    target = range;
    return { prompt: primm.investigate, reply: click };
  };

  function clicked(file: string, line: number) {
    if (view?.phase !== "investigate" || !target) return;
    const right = file === target.file && line >= target.start && line <= target.end;
    const answer = right ? rightAnswer : wrongAnswer;
    options.showFile(target.file, target);
    options.tell(answer);
    settle?.(answer);
  }

  return {
    get view() {
      return view;
    },
    get predicting() {
      return view?.phase === "predict";
    },
    interlude,
    predict(text: string) {
      if (view?.phase === "predict") settle?.(text);
    },
    skip: () => settle?.(undefined),
    clicked,
    reset() {
      done.delete(options.tour());
    },
  };
}
