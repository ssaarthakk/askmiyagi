import type {
  AnswerReply,
  DebriefReply,
  Difficulty,
  InterviewQuestion,
  StartReply,
} from "../../shared/interview.ts";
import { sameConcept } from "../../shared/learner.ts";
import type { Result } from "../../shared/result.ts";
import { resolveAnchors } from "../code/anchor-resolver.ts";
import { readRepo, renderRepoMap } from "../code/repo-map.ts";
import { clearOverlay, setOverlay } from "../files/overlay.ts";
import { createInterviewGrader } from "../llm/interview-grader.ts";
import { createInterviewPlanner } from "../llm/interview-planner.ts";
import { createInterviewer } from "../llm/interviewer.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { CallLog } from "../llm/tools-off-call.ts";
import { leaksHint } from "./no-hints.ts";
import { type Asked, recentCommits, usableQuestions } from "./questions.ts";
import { interviewRules, isWeak, overallScore, sessionMs } from "./rules.ts";

const minimumQuestions = 4;
const forcedNext = "Let's move on.";
const hintReplacement = "Can you say more?";
const timeUp = "That's time. Thank you.";
const noInterview = "No interview is running. Start one first.";
const noDebrief = "There is no finished interview to debrief.";
const turnRunning = "The interviewer is still replying. Wait for it, then answer.";

export const sessionConflicts = [noInterview, noDebrief, turnRunning];

type Running = {
  difficulty: Difficulty;
  questions: Asked[];
  index: number;
  endsAt: number;
};

function showDrill(root: string, { questions, index }: Running) {
  const drilled = questions[index]?.drilled;
  if (drilled) setOverlay(root, drilled.relPath, drilled.source);
  else clearOverlay();
}

function view({ questions, index }: Running): InterviewQuestion | null {
  const asked = questions[index];
  if (!asked) return null;
  const { kind, concept, question } = asked.planned;
  return {
    number: index + 1,
    total: questions.length,
    kind,
    concept,
    question,
    range: asked.range,
  };
}

function distinctConcepts(names: string[]) {
  return names.filter(
    (name, index) => names.findIndex((other) => sameConcept(other, name)) === index,
  );
}

export function createInterviewSession(options: {
  root: string;
  provider: LLMProvider;
  callLog?: CallLog;
  weakConcepts: () => Promise<string[]>;
  markWeak: (concepts: string[]) => Promise<void>;
}) {
  const { root } = options;
  const plan = createInterviewPlanner(options.provider, root, options.callLog);
  const takeTurn = createInterviewer(options.provider, root, options.callLog);
  const grade = createInterviewGrader(options.provider, root, options.callLog);
  let running: Running | undefined;
  let finished: Running | undefined;
  let generation = 0;
  let replying = false;

  function end(done?: Running) {
    generation += 1;
    running = undefined;
    finished = done;
    clearOverlay();
  }

  async function plannedQuestions(difficulty: Difficulty, isCurrent: () => boolean) {
    const weak = await options.weakConcepts();
    const planned = await plan({
      difficulty,
      repoMap: await renderRepoMap(await readRepo(root)),
      gitLog: await recentCommits(root),
      weakConcepts: weak,
    });
    if (!planned.ok) return planned;
    if (!isCurrent()) return { ok: false as const, error: noInterview };
    return {
      ok: true as const,
      value: await usableQuestions(root, planned.value, difficulty, weak),
    };
  }

  async function start(difficulty: Difficulty): Promise<Result<StartReply>> {
    end();
    const startedAs = generation;
    const isCurrent = () => generation === startedAs;
    const questions = await plannedQuestions(difficulty, isCurrent);
    if (!isCurrent()) return { ok: false, error: noInterview };
    if (!questions.ok) return questions;
    if (questions.value.length < minimumQuestions) {
      return {
        ok: false,
        error: `The interviewer could only come up with ${questions.value.length} usable questions. Try again.`,
      };
    }
    const started: Running = {
      difficulty,
      questions: questions.value,
      index: 0,
      endsAt: Date.now() + sessionMs,
    };
    running = started;
    showDrill(root, started);
    const first = view(started);
    return first
      ? { ok: true, value: { ...first, endsAt: started.endsAt } }
      : { ok: false, error: noInterview };
  }

  async function turn(current: Running, asked: Asked, text: string): Promise<Result<AnswerReply>> {
    const { exchanges } = asked;
    const probesLeft = interviewRules[current.difficulty].probes - exchanges.length;
    const reply = await takeTurn({
      difficulty: current.difficulty,
      kind: asked.planned.kind,
      question: asked.planned.question,
      code: asked.code,
      earlier: exchanges,
      answer: text,
      probesLeft,
    });
    if (!reply.ok) return reply;
    if (running !== current) return { ok: false, error: noInterview };
    const spoken = leaksHint(reply.value.say, [asked.source, asked.planned.modelAnswer])
      ? hintReplacement
      : reply.value.say;
    if (reply.value.action !== "next" && probesLeft > 0) {
      exchanges.push({ answered: text, said: spoken });
      return {
        ok: true,
        value: { action: reply.value.action, say: spoken, next: null, finished: false },
      };
    }
    const say = reply.value.action === "next" ? spoken : forcedNext;
    exchanges.push({ answered: text, said: say });
    current.index += 1;
    showDrill(root, current);
    const next = view(current);
    if (!next) end(current);
    return { ok: true, value: { action: "next", say, next, finished: next === null } };
  }

  async function answer(text: string): Promise<Result<AnswerReply>> {
    const current = running;
    const asked = current?.questions[current.index];
    if (!current || !asked) return { ok: false, error: noInterview };
    if (replying) return { ok: false, error: turnRunning };
    if (Date.now() >= current.endsAt) {
      asked.exchanges.push({ answered: text, said: timeUp });
      end(current);
      return { ok: true, value: { action: "next", say: timeUp, next: null, finished: true } };
    }
    replying = true;
    try {
      return await turn(current, asked, text);
    } finally {
      replying = false;
    }
  }

  async function debrief(): Promise<Result<DebriefReply>> {
    const done = finished;
    if (!done) return { ok: false, error: noDebrief };
    const answered = done.questions
      .map((asked, index) => ({ asked, number: index + 1 }))
      .filter(({ asked }) => asked.exchanges.length > 0);
    const graded = await grade({
      questions: answered.map(({ asked, number }) => ({
        number,
        kind: asked.planned.kind,
        concept: asked.planned.concept,
        question: asked.planned.question,
        code: asked.code,
        modelAnswer: asked.planned.modelAnswer,
        exchanges: asked.exchanges,
      })),
    });
    if (!graded.ok) return graded;
    if (finished !== done) return { ok: false, error: noDebrief };
    const grades = [];
    for (const { asked, number } of answered) {
      const found = graded.value.find((one) => one.number === number);
      if (!found) return { ok: false, error: `The grader skipped question ${number}. Try again.` };
      grades.push({ asked, found });
    }
    const weak = distinctConcepts(
      grades.filter(({ found }) => isWeak(found)).map(({ asked }) => asked.planned.concept),
    );
    if (weak.length > 0) await options.markWeak(weak);
    finished = undefined;
    return {
      ok: true,
      value: {
        overall: overallScore(grades.map(({ found }) => found)),
        weak,
        questions: await Promise.all(
          grades.map(async ({ asked, found }) => ({
            number: found.number,
            kind: asked.planned.kind,
            concept: asked.planned.concept,
            question: asked.planned.question,
            scores: found.scores,
            gaps: found.gaps,
            ranges: await resolveAnchors(root, found.anchors),
            modelAnswer: found.modelAnswer,
          })),
        ),
      },
    };
  }

  return {
    start,
    answer,
    debrief,
    get running() {
      return running !== undefined;
    },
    stop: () => end(),
  };
}
