import { writeFile } from "node:fs/promises";
import {
  type ConceptState,
  conceptStates,
  type Learner,
  type LearnerConcept,
  learnerSchema,
  sameConcept,
  type TourConcept,
} from "../../shared/learner.ts";
import { readPrivateJson, writePrivateFile } from "../tutor-folder.ts";

const learnerFile = "learner.json";
const reviewDays = [1, 3, 7];
const maxAttempts = 3;
const dayMs = 86_400_000;

function later(first: ConceptState, second: ConceptState) {
  return conceptStates.indexOf(second) > conceptStates.indexOf(first) ? second : first;
}

function inDays(now: Date, days: number) {
  return new Date(now.getTime() + days * dayMs).toISOString();
}

function reached(learner: Learner, concepts: TourConcept[], state: ConceptState): Learner {
  const next = [...learner.concepts];
  for (const concept of concepts) {
    const index = next.findIndex((known) => sameConcept(known.name, concept.name));
    const known = next[index];
    if (known === undefined) {
      next.push({
        ...concept,
        state,
        rubric: null,
        attempts: 0,
        reviewsDone: 0,
        nextReview: null,
      });
    } else {
      next[index] = {
        ...known,
        important: known.important || concept.important,
        state: later(known.state, state),
      };
    }
  }
  return { concepts: next };
}

function withoutWeak({ weak: _weak, ...known }: LearnerConcept): LearnerConcept {
  return known;
}

function markedWeak(learner: Learner, names: string[]): Learner {
  const concepts = names.map((name) => ({ name, kind: "repo" as const, important: true }));
  const { concepts: next } = reached(learner, concepts, "seen");
  return {
    concepts: next.map((known) =>
      names.some((name) => sameConcept(name, known.name)) ? { ...known, weak: true } : known,
    ),
  };
}

function graded(known: LearnerConcept, passed: boolean, review: boolean, now: Date) {
  if (passed && !review) {
    const concept = {
      ...withoutWeak(known),
      state: later(known.state, "checked"),
      attempts: 0,
      reviewsDone: 0,
      nextReview: inDays(now, reviewDays[0] ?? 1),
    };
    return { concept, result: "passed" as const };
  }
  if (passed) {
    const failedBefore = known.attempts > 0;
    const reviewsDone = failedBefore ? 0 : known.reviewsDone + 1;
    const days = failedBefore ? reviewDays[0] : reviewDays[reviewsDone];
    const nextReview = days === undefined ? null : inDays(now, days);
    const concept = {
      ...withoutWeak(known),
      state: "reviewed" as const,
      attempts: 0,
      reviewsDone,
      nextReview,
    };
    return { concept, result: "passed" as const };
  }
  const attempts = known.attempts + 1;
  const restarted = { ...known, reviewsDone: 0, nextReview: inDays(now, reviewDays[0] ?? 1) };
  if (attempts >= maxAttempts)
    return { concept: { ...restarted, attempts: 0 }, result: "gave-up" as const };
  const concept = review ? { ...restarted, attempts } : { ...known, attempts };
  return { concept, result: "retry" as const };
}

export function createLearnerRecord(root: string) {
  let queue: Promise<unknown> = Promise.resolve();

  function change<T>(update: (learner: Learner) => { learner?: Learner; result: T }) {
    const run = queue.then(async (): Promise<T | undefined> => {
      const current = await readPrivateJson(root, learnerFile, learnerSchema);
      if (!current.ok) return undefined;
      const { learner, result } = update(current.value ?? { concepts: [] });
      if (learner) {
        await writePrivateFile(root, learnerFile, "Learner record not saved", (file) =>
          writeFile(file, JSON.stringify(learner, null, 2)),
        );
      }
      return result;
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function changeConcept<T>(
    name: string,
    update: (known: LearnerConcept) => { concept: LearnerConcept; result: T },
  ) {
    return change((learner) => {
      const index = learner.concepts.findIndex((known) => sameConcept(known.name, name));
      const known = learner.concepts[index];
      if (known === undefined) return { result: undefined };
      const { concept, result } = update(known);
      return { learner: { concepts: learner.concepts.with(index, concept) }, result };
    });
  }

  async function conceptNames(keep: (concept: LearnerConcept) => boolean) {
    const names = await change((learner) => ({
      result: learner.concepts.filter(keep).map(({ name }) => name),
    }));
    return names ?? [];
  }

  function reach(concepts: TourConcept[], state: ConceptState) {
    return change((learner) => ({ learner: reached(learner, concepts, state), result: undefined }));
  }

  return {
    markSeen: (concepts: TourConcept[]) => reach(concepts, "seen"),
    markExplained: (concepts: TourConcept[]) => reach(concepts, "explained"),
    markWeak: (names: string[]) =>
      change((learner) => ({ learner: markedWeak(learner, names), result: undefined })),
    checkedConcepts: () =>
      conceptNames(
        ({ state, weak }) => weak !== true && (state === "checked" || state === "reviewed"),
      ),
    explainedConcepts: () => conceptNames(({ state }) => state !== "seen"),
    weakConcepts: () => conceptNames(({ weak }) => weak === true),
    concept: (name: string) =>
      change((learner) => ({
        result: learner.concepts.find((known) => sameConcept(known.name, name)),
      })),
    setRubric: (name: string, rubric: string) =>
      changeConcept(name, (known) => ({ concept: { ...known, rubric }, result: undefined })),
    grade: (name: string, passed: boolean, review: boolean, now = new Date()) =>
      changeConcept(name, (known) => graded(known, passed, review, now)),
    forgetAttempts: (name: string) =>
      changeConcept(name, (known) => ({ concept: { ...known, attempts: 0 }, result: undefined })),
    skipReview: (name: string, now = new Date()) =>
      changeConcept(name, (known) => ({
        concept:
          known.nextReview === null ? known : { ...known, attempts: 0, nextReview: inDays(now, 1) },
        result: undefined,
      })),
    async dueReviews(now = new Date()) {
      const names = await change((learner) => ({
        result: learner.concepts
          .filter(
            ({ nextReview }) => nextReview !== null && Date.parse(nextReview) <= now.getTime(),
          )
          .map(({ name }) => name),
      }));
      return names ?? [];
    },
  };
}

export type LearnerRecord = ReturnType<typeof createLearnerRecord>;
