import type { ResolvedAnchor } from "../../shared/anchor.ts";
import type { Difficulty, PlannedQuestion } from "../../shared/interview.ts";
import { sameConcept } from "../../shared/learner.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { readRedactedFile, sourceLines } from "../files/path-guard.ts";
import type { Exchange } from "../llm/interviewer.ts";
import { highlightedBlock } from "../llm/position.ts";
import { logError } from "../log.ts";
import { gitTool } from "../tools/git.ts";
import { drillSource } from "./drill.ts";
import { interviewRules } from "./rules.ts";

export type Asked = {
  planned: PlannedQuestion;
  range: ResolvedAnchor;
  code: string;
  source: string;
  drilled: { relPath: string; source: string } | undefined;
  exchanges: Exchange[];
};

export async function recentCommits(root: string) {
  const log = await gitTool(root, { command: "log", args: ["--oneline", "-n", "30"] });
  return log.isError ? "No git history." : log.text;
}

function dropped(reason: string) {
  logError(`Interview question dropped: ${reason}`);
  return undefined;
}

async function drillOf(root: string, planned: PlannedQuestion, anchoredFile: string) {
  if (planned.kind !== "drill") return { ok: true as const, value: undefined };
  if (!planned.drill) return { ok: false as const, error: "it has no drill" };
  const drilled = await drillSource(root, planned.drill);
  if (drilled.ok && drilled.value.relPath !== anchoredFile) {
    return { ok: false as const, error: "its drill is on another file than its anchor" };
  }
  return drilled;
}

async function anchored(root: string, planned: PlannedQuestion): Promise<Asked | undefined> {
  const range = await resolveAnchor(root, planned.anchor);
  if (!range.ok) return dropped(range.error);
  const drilled = await drillOf(root, planned, range.value.file);
  if (!drilled.ok) return dropped(drilled.error);
  const file = await readRedactedFile(root, range.value.file);
  if (!file.ok) return dropped("its code could not be read");
  const source = drilled.value?.source ?? file.value.source;
  return {
    planned,
    range: range.value,
    code: highlightedBlock(range.value, source),
    source: sourceLines(source)
      .slice(range.value.start - 1, range.value.end)
      .join("\n"),
    drilled: drilled.value,
    exchanges: [],
  };
}

function withinMix(questions: Asked[], difficulty: Difficulty) {
  const left = { ...interviewRules[difficulty].mix };
  return questions.filter(({ planned }) => {
    if (left[planned.kind] === 0) return false;
    left[planned.kind] -= 1;
    return true;
  });
}

function weakFirst(questions: Asked[], weak: string[]) {
  const isWeak = ({ planned }: Asked) => weak.some((name) => sameConcept(name, planned.concept));
  return [...questions.filter(isWeak), ...questions.filter((asked) => !isWeak(asked))];
}

export async function usableQuestions(
  root: string,
  planned: PlannedQuestion[],
  difficulty: Difficulty,
  weak: string[],
) {
  const usable = (await Promise.all(planned.map((question) => anchored(root, question)))).filter(
    (asked) => asked !== undefined,
  );
  return weakFirst(withinMix(usable, difficulty), weak);
}
