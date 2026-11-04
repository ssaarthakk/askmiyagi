import type { ResolvedAnchor } from "../../shared/anchor.ts";
import type { EvalCase } from "../../shared/eval-suite.ts";
import type { AskEvent } from "../../shared/events.ts";
import { anchorRanges, type Step, stepAnchors } from "../../shared/tour.ts";
import type { Usage } from "../../shared/usage.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { guardPath } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";

export type EvalRun = {
  events: AskEvent[];
  filesOpened: string[];
  toolCalls: number;
  usage: Usage;
  durationMs: number;
  questionInAnswerMode: boolean;
};

type Range = Pick<ResolvedAnchor, "file" | "start" | "end">;

const codeSymbols = /[(){}[\];=<>`]|::/;

async function resolveReference(root: string, reference: string): Promise<Range | null> {
  const [file = "", symbol] = reference.split("#");
  if (symbol === undefined) {
    const guarded = await guardPath(root, file);
    return guarded.ok
      ? { file: guarded.value.relPath, start: 1, end: Number.POSITIVE_INFINITY }
      : null;
  }
  const resolved = await resolveAnchor(root, { file, symbol });
  return resolved.ok ? resolved.value : null;
}

function overlaps(reference: Range | null, range: Range | null) {
  return (
    reference !== null &&
    range !== null &&
    reference.file === range.file &&
    reference.start <= range.end &&
    range.start <= reference.end
  );
}

function inOrder(references: (Range | null)[], ranges: (Range | null)[]) {
  let next = 0;
  for (const reference of references) {
    const found = ranges.findIndex((range, index) => index >= next && overlaps(reference, range));
    if (found === -1) return false;
    next = found + 1;
  }
  return true;
}

function spokenLines(step: Step) {
  const prompts = step.primm ? [step.primm.predict, step.primm.investigate] : [];
  return [...step.narration.map((part) => part.text), ...prompts];
}

function stepLines(step: Step) {
  const anchorTexts = stepAnchors(step).flatMap((anchor) =>
    "text" in anchor ? [anchor.text] : [],
  );
  return [step.title, ...anchorTexts, ...spokenLines(step)];
}

function outputLines(events: AskEvent[]) {
  return events.flatMap((event) => {
    if (event.type === "ack" || event.type === "progress") return [event.text];
    if (event.type === "error") return [event.message];
    if (event.type === "step") return stepLines(event.step);
    if (event.type !== "tour") return [];
    return [
      ...event.tour.steps.flatMap(stepLines),
      event.tour.reply ?? "",
      event.tour.checkQuestion ?? "",
    ];
  });
}

export async function runCodeChecks(
  root: string,
  testCase: EvalCase,
  run: EvalRun,
): Promise<Record<string, boolean | number>> {
  const tourEvent = run.events.find((event) => event.type === "tour");
  const failed = run.events.some((event) => event.type === "error");
  const validJson = tourEvent !== undefined && !failed;
  const ranges = validJson ? anchorRanges(tourEvent.tour.steps, tourEvent.ranges).flat() : [];
  const references = await Promise.all(
    [...testCase.mustHighlight, ...testCase.expectedOrder].map((reference) =>
      resolveReference(root, reference),
    ),
  );
  const mustHighlight = references.slice(0, testCase.mustHighlight.length);
  const expectedOrder = references.slice(testCase.mustHighlight.length);

  const tour = validJson ? tourEvent.tour : undefined;
  const narration = (tour?.steps ?? []).flatMap((step) => step.narration.map((part) => part.text));
  const reply = tour?.reply;
  const checkQuestion = tour?.checkQuestion;
  const replySentences = (reply ?? "").split(/(?<=[.!?])\s+/);
  const spoken = [...(tour?.steps ?? []).flatMap(spokenLines), reply ?? "", checkQuestion ?? ""];
  const heard = [...narration, reply ?? ""].join("\n").toLowerCase();
  const output = outputLines(run.events).join("\n");
  const blocked = await Promise.all(
    run.filesOpened.map(async (path) => !(await guardPath(root, path)).ok),
  );

  return {
    highlights:
      validJson &&
      mustHighlight.every((reference) => ranges.some((range) => overlaps(reference, range))),
    startingPoint:
      validJson &&
      (expectedOrder.length === 0 || overlaps(expectedOrder[0] ?? null, ranges[0] ?? null)),
    flowOrder: validJson && inOrder(expectedOrder, ranges),
    validJson,
    anchorFailureRate:
      ranges.length === 0 ? 0 : ranges.filter((range) => !range).length / ranges.length,
    noCodeInNarration: validJson && !spoken.some((text) => codeSymbols.test(text)),
    questionsOnlyAtEnd:
      validJson &&
      !(tourEvent.tour.steps.length === 0 && checkQuestion !== undefined) &&
      !run.questionInAnswerMode &&
      !narration.some((text) => text.trimEnd().endsWith("?")) &&
      !replySentences.some((sentence) => sentence.trimEnd().endsWith("?")),
    noBlockedReads: !blocked.some(Boolean),
    noSecrets: redact(output) === output,
    keyFacts: validJson && testCase.keyFacts.every((fact) => heard.includes(fact.toLowerCase())),
    latencyMs: run.durationMs,
    ...(run.usage.costUsd === null ? {} : { costUsd: run.usage.costUsd }),
    toolCalls: run.toolCalls,
  };
}
