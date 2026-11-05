import type { PathReplyItems } from "../shared/path.ts";
import { fetchPath, postPlan } from "./path.ts";
import { errorText } from "./response-error.ts";

const goalQuestion = "What do you want to do with this repo?";

export function createPath(options: {
  token: string;
  goal: () => string | null | undefined;
  saveGoal: (goal: string) => Promise<void>;
  tutorSays: (text: string) => void;
  problem: (text: string) => void;
  openTurn: () => void;
}) {
  let items = $state<PathReplyItems>();
  let planning = $state(false);
  let askingGoal = $state(false);

  async function refresh() {
    try {
      items = (await fetchPath(options.token))?.items;
    } catch (error) {
      console.warn("Could not load the learning path", error);
    }
  }

  async function planNow() {
    planning = true;
    try {
      items = (await postPlan(options.token))?.items;
    } catch (error) {
      options.problem(errorText(error));
    } finally {
      planning = false;
    }
  }

  void refresh();

  return {
    get items() {
      return items;
    },
    get planning() {
      return planning;
    },
    get askingGoal() {
      return askingGoal;
    },
    refresh,
    async plan() {
      if (planning) return;
      options.openTurn();
      if (options.goal()) {
        await planNow();
        return;
      }
      askingGoal = true;
      options.tutorSays(goalQuestion);
    },
    async answerGoal(text: string) {
      askingGoal = false;
      try {
        await options.saveGoal(text);
      } catch (error) {
        options.problem(errorText(error));
        return;
      }
      await planNow();
    },
    cancelGoal() {
      askingGoal = false;
    },
  };
}
