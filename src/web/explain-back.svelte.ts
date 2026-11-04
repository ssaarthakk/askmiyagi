import type { ResolvedAnchor } from "../shared/anchor.ts";
import { type ExplainBackReply, explainBackPrompt } from "../shared/learner.ts";
import { postSkipped } from "./played.ts";
import { errorText } from "./response-error.ts";
import { fetchDue, postExplainBack, postReviewSkipped } from "./reviews.ts";

type Waiting = { concept: string; review: boolean };

function reply(concept: string, result: ExplainBackReply) {
  const gaps = result.gaps.join(" ");
  if (result.outcome === "passed") {
    return [`That's a good explanation of ${concept}.`, gaps].filter(Boolean).join(" ");
  }
  if (result.outcome === "retry") return `Not quite yet. ${gaps} Try again, or skip.`;
  return `Let's stop here. ${gaps} A good answer would be: ${result.modelAnswer ?? ""} I'll ask you again tomorrow.`;
}

export function createExplainBack(options: {
  token: string;
  tour: () => string;
  tutorSays: (text: string) => void;
  learnerSays: (text: string) => void;
  problem: (text: string) => void;
  openTurn: () => void;
  showFile: (file: string, range: ResolvedAnchor) => void;
}) {
  let waiting = $state<Waiting>();
  let grading = false;
  let due = $state<string[]>([]);
  let offer = $state<string>();

  function warn(action: string) {
    return (error: unknown) => console.warn(`Could not ${action}`, error);
  }

  async function refreshDue() {
    try {
      due = await fetchDue(options.token);
    } catch (error) {
      warn("load the due reviews")(error);
    }
  }

  function startReview(concept: string) {
    options.openTurn();
    waiting = { concept, review: true };
    options.tutorSays(explainBackPrompt(concept));
  }

  void refreshDue();

  return {
    get concept() {
      return waiting?.concept;
    },
    get due() {
      return due;
    },
    get offer() {
      return offer;
    },
    expect(concept: string) {
      waiting = { concept, review: false };
    },
    clear() {
      if (waiting?.review) {
        void postReviewSkipped(waiting.concept, options.token).then(
          refreshDue,
          warn("skip the review"),
        );
      }
      waiting = undefined;
      offer = undefined;
    },
    async answer(text: string) {
      const current = waiting;
      if (!current || grading) return false;
      grading = true;
      options.learnerSays(text);
      try {
        const result = await postExplainBack(current.concept, text, current.review, options.token);
        const range = result.ranges[0];
        if (range) options.showFile(range.file, range);
        options.tutorSays(reply(current.concept, result));
        if (result.outcome === "retry") return false;
        waiting = undefined;
        void refreshDue();
        return true;
      } catch (error) {
        options.problem(errorText(error));
        return false;
      } finally {
        grading = false;
      }
    },
    skip() {
      const current = waiting;
      if (!current) return;
      waiting = undefined;
      const reported = current.review
        ? postReviewSkipped(current.concept, options.token)
        : postSkipped(options.tour(), options.token);
      void reported.then(refreshDue, warn("report the skipped question"));
    },
    startReview,
    async offerReview() {
      await refreshDue();
      if (!waiting && offer === undefined) offer = due[0];
    },
    startOffer() {
      const concept = offer;
      offer = undefined;
      if (concept) startReview(concept);
    },
    skipOffer() {
      const concept = offer;
      offer = undefined;
      if (concept) {
        void postReviewSkipped(concept, options.token).then(refreshDue, warn("skip the review"));
      }
    },
  };
}
