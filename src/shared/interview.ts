import { z } from "zod";
import { anchorSchema, resolvedAnchorSchema } from "./anchor.ts";
import { gradeSchema } from "./learner.ts";

const difficultySchema = z.enum(["friendly", "realistic", "tough"]);

const questionKindSchema = z.enum(["explain", "why", "drill"]);

const drillSchema = z.object({
  file: z.string().min(1),
  edits: z
    .array(z.object({ find: z.string().min(1).max(2000), replace: z.string().max(2000) }))
    .min(1)
    .max(3),
});

const plannedQuestionSchema = z.object({
  kind: questionKindSchema,
  concept: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(500),
  modelAnswer: z.string().trim().min(1).max(1500),
  anchor: anchorSchema,
  drill: drillSchema.optional(),
});

export const interviewPlanSchema = z.object({ questions: z.array(plannedQuestionSchema) });

export const interviewTurnSchema = z.object({
  action: z.enum(["probe", "pushback", "next"]),
  say: z.string().trim().min(1).max(500),
});

const scoreSchema = z.number().int().min(1).max(5);

const scoresSchema = z.object({
  accuracy: scoreSchema,
  reasoning: scoreSchema,
  depth: scoreSchema,
  clarity: scoreSchema,
});

const interviewGradeSchema = gradeSchema.omit({ score: true }).extend({
  number: z.number().int().positive(),
  scores: scoresSchema,
});

export const interviewGradesSchema = z.object({ grades: z.array(interviewGradeSchema) });

export const startBodySchema = z.object({ difficulty: difficultySchema.default("realistic") });

export const answerBodySchema = z.object({ answer: z.string().trim().min(1).max(4000) });

const interviewQuestionSchema = z.object({
  number: z.number().int().positive(),
  total: z.number().int().positive(),
  kind: questionKindSchema,
  concept: z.string(),
  question: z.string(),
  range: resolvedAnchorSchema,
});

export const startReplySchema = interviewQuestionSchema.extend({ endsAt: z.number().int() });

export const answerReplySchema = interviewTurnSchema.extend({
  next: interviewQuestionSchema.nullable(),
  finished: z.boolean(),
});

export const debriefReplySchema = z.object({
  overall: z.number(),
  weak: z.array(z.string()),
  questions: z.array(
    interviewQuestionSchema.omit({ total: true, range: true }).extend({
      scores: scoresSchema,
      gaps: z.array(z.string()),
      ranges: z.array(resolvedAnchorSchema),
      modelAnswer: z.string(),
    }),
  ),
});

export type Difficulty = z.infer<typeof difficultySchema>;
export type Drill = z.infer<typeof drillSchema>;
export type PlannedQuestion = z.infer<typeof plannedQuestionSchema>;
export type InterviewTurn = z.infer<typeof interviewTurnSchema>;
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;
export type StartReply = z.infer<typeof startReplySchema>;
export type AnswerReply = z.infer<typeof answerReplySchema>;
export type InterviewGrade = z.infer<typeof interviewGradeSchema>;
export type DebriefReply = z.infer<typeof debriefReplySchema>;
