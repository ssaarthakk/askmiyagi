import { sameConcept, type TourConcept } from "../../shared/learner.ts";
import type { Profile } from "../../shared/profile.ts";
import type { Result } from "../../shared/result.ts";

const everyNthTour = { light: 3, normal: 2, frequent: 1 } as const;
const skipsInARow = 2;
const suppressedTours = 3;

export function createQuestionPolicy() {
  let eligibleTours = 0;
  let suppressed = 0;
  let skipStreak = 0;
  let questionsSinceSkip = 0;

  return {
    mayAsk(frequency: Profile["frequency"]) {
      return suppressed === 0 && (eligibleTours + 1) % everyNthTour[frequency] === 0;
    },
    tourEnded(questionKept: boolean) {
      eligibleTours += 1;
      if (suppressed > 0) suppressed -= 1;
      if (questionKept) questionsSinceSkip += 1;
    },
    skipped() {
      skipStreak = questionsSinceSkip === 1 ? skipStreak + 1 : 1;
      questionsSinceSkip = 0;
      if (skipStreak === skipsInARow) {
        suppressed = suppressedTours;
        skipStreak = 0;
      }
    },
  };
}

export type QuestionPolicy = ReturnType<typeof createQuestionPolicy>;

type Candidate = {
  allowed: boolean;
  concept: string | undefined;
  concepts: TourConcept[];
  checked: string[];
};

export function vetQuestion(candidate: Candidate): Result<string> {
  const { concept, concepts, checked } = candidate;
  if (!candidate.allowed) return { ok: false, error: "no question is allowed for this ask" };
  const named = concepts.find((known) => concept !== undefined && sameConcept(known.name, concept));
  if (!named) return { ok: false, error: `"${concept}" is not one of the tour's concepts` };
  if (!named.important) return { ok: false, error: `"${named.name}" is not important` };
  if (checked.some((name) => sameConcept(name, named.name))) {
    return { ok: false, error: `"${named.name}" is already checked` };
  }
  return { ok: true, value: named.name };
}
