import type { DiffBase } from "../../shared/diff-base.ts";
import { type ExplainBackReply, sameConcept } from "../../shared/learner.ts";
import type { Result } from "../../shared/result.ts";
import type { Tour } from "../../shared/tour.ts";
import { resolveAnchors } from "../code/anchor-resolver.ts";
import type { Conversation } from "../llm/conversation.ts";
import { createGrader } from "../llm/grader.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { createRubricWriter } from "../llm/rubric.ts";
import type { CallLog } from "../llm/tools-off-call.ts";
import { tourContext } from "../llm/tour-context.ts";
import { logError } from "../log.ts";
import type { LearnerRecord } from "./learner.ts";

const passScore = 4;

export const unknownConcept = "That concept is not in your learner record";

export function createExplainBack(options: {
  root: string;
  provider: LLMProvider;
  learner: LearnerRecord;
  conversation: Conversation;
  callLog?: CallLog;
}) {
  const { root, learner } = options;
  const writeRubric = createRubricWriter(options.provider, root, options.callLog);
  const grade = createGrader(options.provider, root, options.callLog);
  const writing = new Map<string, Promise<void>>();

  async function saveRubric(
    concept: string,
    tour: Tour,
    base: DiffBase | undefined,
    latest: () => boolean,
  ) {
    try {
      const rubric = await writeRubric({
        concept,
        question: tour.checkQuestion,
        context: await tourContext(root, tour, base),
      });
      if (!rubric.ok) logError(`Rubric for "${concept}" not written: ${rubric.error}`);
      else if (latest()) await learner.setRubric(concept, rubric.value);
    } catch (error) {
      logError(
        `Rubric for "${concept}" not written: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    startRubric(concept: string, tour: Tour, base?: DiffBase) {
      const key = concept.toLowerCase();
      void learner.forgetAttempts(concept);
      const running = saveRubric(concept, tour, base, () => writing.get(key) === running);
      writing.set(key, running);
    },

    async grade(
      concept: string,
      answer: string,
      review = false,
    ): Promise<Result<ExplainBackReply>> {
      await writing.get(concept.toLowerCase());
      const known = await learner.concept(concept);
      if (!known) return { ok: false, error: unknownConcept };
      const turn = options.conversation.turnAboutConcept(known.name);
      const context = turn ? await tourContext(root, turn.tour, turn.base) : "";
      const question =
        !review && turn?.tour.checkConcept && sameConcept(turn.tour.checkConcept, known.name)
          ? turn.tour.checkQuestion
          : undefined;
      const graded = await grade({
        concept: known.name,
        question,
        rubric: known.rubric,
        context,
        answer,
      });
      if (!graded.ok) return graded;
      const { score, gaps, anchors, modelAnswer } = graded.value;
      const outcome = await learner.grade(known.name, score >= passScore, review);
      if (!outcome) return { ok: false, error: "The learner record could not be updated" };
      return {
        ok: true,
        value: {
          outcome,
          score,
          gaps,
          ranges: await resolveAnchors(root, anchors),
          modelAnswer: outcome === "gave-up" ? modelAnswer : null,
        },
      };
    },
  };
}
