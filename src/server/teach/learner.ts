import { writeFile } from "node:fs/promises";
import {
  type ConceptState,
  conceptStates,
  type Learner,
  learnerSchema,
  type TourConcept,
} from "../../shared/learner.ts";
import { readPrivateJson, writePrivateFile } from "../tutor-folder.ts";

const learnerFile = "learner.json";

function later(first: ConceptState, second: ConceptState) {
  return conceptStates.indexOf(second) > conceptStates.indexOf(first) ? second : first;
}

function reached(learner: Learner, concepts: TourConcept[], state: ConceptState): Learner {
  const next = [...learner.concepts];
  for (const concept of concepts) {
    const index = next.findIndex(
      (known) => known.name.toLowerCase() === concept.name.toLowerCase(),
    );
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

export function createLearnerRecord(root: string) {
  let queue: Promise<void> = Promise.resolve();

  function reach(concepts: TourConcept[], state: ConceptState) {
    queue = queue.then(async () => {
      const current = await readPrivateJson(root, learnerFile, learnerSchema);
      if (!current.ok) return;
      const updated = reached(current.value ?? { concepts: [] }, concepts, state);
      await writePrivateFile(root, learnerFile, "Learner record not saved", (file) =>
        writeFile(file, JSON.stringify(updated, null, 2)),
      );
    });
    return queue;
  }

  return {
    markSeen: (concepts: TourConcept[]) => reach(concepts, "seen"),
    markExplained: (concepts: TourConcept[]) => reach(concepts, "explained"),
  };
}
