import type { Difficulty, InterviewGrade, PlannedQuestion } from "../../shared/interview.ts";

type Rules = { probes: number; style: string; mix: Record<PlannedQuestion["kind"], number> };

export const sessionMs = 20 * 60 * 1000;

const weakAtOrBelow = 2;

export const interviewRules: Record<Difficulty, Rules> = {
  friendly: {
    probes: 1,
    style: "Be warm. Push back gently, and only on a clear mistake.",
    mix: { explain: 5, why: 1, drill: 0 },
  },
  realistic: {
    probes: 2,
    style: "Push back on vague or wrong claims.",
    mix: { explain: 4, why: 1, drill: 1 },
  },
  tough: {
    probes: 3,
    style: "Challenge every claim, and ask for tradeoffs and failure cases.",
    mix: { explain: 2, why: 2, drill: 2 },
  },
};

export function mixText(difficulty: Difficulty) {
  const { explain, why, drill } = interviewRules[difficulty].mix;
  return `${explain} explain, ${why} why and ${drill} drill`;
}

function mean(numbers: number[]) {
  return numbers.reduce((sum, number) => sum + number, 0) / numbers.length;
}

export function overallScore(grades: Pick<InterviewGrade, "scores">[]) {
  return Math.round(mean(grades.flatMap(({ scores }) => Object.values(scores))) * 10) / 10;
}

export function isWeak({ scores }: Pick<InterviewGrade, "scores">) {
  return mean(Object.values(scores)) <= weakAtOrBelow;
}
