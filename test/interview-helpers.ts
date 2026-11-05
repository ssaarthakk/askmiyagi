import { createInterviewSession } from "../src/server/interview/session.ts";
import type { LLMProvider } from "../src/server/llm/provider.ts";
import type { Anchor } from "../src/shared/anchor.ts";
import type { PlannedQuestion } from "../src/shared/interview.ts";
import type { LLMRequest } from "../src/shared/llm-request.ts";
import type { Result } from "../src/shared/result.ts";
import { scripted, usage } from "./ask-helpers.ts";
import { writePathProject } from "./path-project.ts";

export const interviewAnchors: Record<string, Anchor> = {
  store: { file: "src/store.ts", line: 1, text: "export const read = 1;" },
  server: { file: "src/server.ts", line: 2, text: "export const serve = read;" },
  main: { file: "src/main.ts", line: 2, text: "serve();" },
  clip: { file: "src/clip.ts", line: 2, text: "export const clip = read;" },
  orphan: { file: "src/orphan.ts", line: 1, text: "export const orphan = 1;" },
  missing: { file: "src/missing.ts", line: 1, text: "export const gone = 1;" },
};

export const storeDrill = {
  file: "src/store.ts",
  edits: [{ find: "export const read = 1;", replace: "export const read = 0;" }],
};

export function planned(
  concept: string,
  anchor: keyof typeof interviewAnchors = "store",
  kind: PlannedQuestion["kind"] = "explain",
): PlannedQuestion {
  return {
    kind,
    concept,
    question: `How does ${concept} work?`,
    modelAnswer: `${concept} keeps one fixed number and hands it on unchanged.`,
    anchor: interviewAnchors[anchor] as Anchor,
    drill: storeDrill,
  };
}

export const sixQuestions = [
  planned("Storage", "store"),
  planned("Serving", "server"),
  planned("Startup", "main"),
  planned("Clips", "clip"),
  planned("Leftovers", "orphan", "why"),
  planned("Breakage", "store", "drill"),
];

export function interviewGrade(
  number: number,
  scores: [number, number, number, number] = [4, 4, 4, 4],
  extra: { gaps?: string[]; anchors?: Anchor[] } = {},
) {
  const [accuracy, reasoning, depth, clarity] = scores;
  return {
    number,
    scores: { accuracy, reasoning, depth, clarity },
    gaps: extra.gaps ?? [],
    anchors: extra.anchors ?? [],
    modelAnswer: `A good answer to question ${number}.`,
  };
}

function everyQuestionGraded(request: LLMRequest) {
  const numbers = [...request.question.matchAll(/^Question (\d+),/gm)].map(([, number]) =>
    Number(number),
  );
  return { grades: numbers.map((number) => interviewGrade(number)) };
}

function gradingReply(request: LLMRequest, gradings: unknown[][]) {
  const grades = gradings.shift();
  return grades ? { grades } : everyQuestionGraded(request);
}

export function interviewProvider(options: {
  questions?: PlannedQuestion[];
  turns?: { action: string; say: string }[];
  gradings?: unknown[][];
  seen?: LLMRequest[];
}): LLMProvider {
  const turns = [...(options.turns ?? [])];
  const gradings = [...(options.gradings ?? [])];
  return {
    async *ask(request) {
      options.seen?.push(request);
      const reply = request.tools
        ? { questions: options.questions ?? sixQuestions }
        : request.system.includes("grading a mock interview")
          ? gradingReply(request, gradings)
          : (turns.shift() ?? { action: "next", say: "Thanks." });
      yield { type: "text", text: JSON.stringify(reply) };
      yield { type: "done", usage };
    },
  };
}

export function textReply(text: string, seen: LLMRequest[] = []) {
  return scripted(
    [
      { type: "text", text },
      { type: "done", usage },
    ],
    seen,
  );
}

export function unwrap<T>(result: Result<T>) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export async function interviewSession(provider: LLMProvider, weak: string[] = []) {
  const root = await writePathProject();
  const weakMarks: string[][] = [];
  const session = createInterviewSession({
    root,
    provider,
    weakConcepts: async () => weak,
    markWeak: async (concepts) => {
      weakMarks.push(concepts);
    },
  });
  return { root, session, weakMarks };
}
