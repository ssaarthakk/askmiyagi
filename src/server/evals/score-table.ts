import { type CaseRun, type EvalResult, failureLabels } from "../../shared/eval-result.ts";

function scoresOf(run: CaseRun): Record<string, boolean | number | undefined> {
  return {
    ...run.checks,
    costUsd: run.checks.costUsd,
    ...run.grades,
  };
}

function checkNames(runs: CaseRun[]) {
  return [...new Set(runs.flatMap((run) => Object.keys(scoresOf(run))))];
}

function isPassFail(runs: CaseRun[], name: string) {
  return runs.some((run) => typeof scoresOf(run)[name] === "boolean");
}

function score(runs: CaseRun[], name: string) {
  const values = runs.flatMap((run) => {
    const value = scoresOf(run)[name];
    return value === undefined ? [] : [Number(value)];
  });
  if (values.length === 0) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return isPassFail(runs, name) ? Math.round(mean * 100) : Number(mean.toFixed(2));
}

function show(name: string, runs: CaseRun[]) {
  const value = score(runs, name);
  if (value === undefined) return "-";
  return isPassFail(runs, name) ? `${value}%` : String(value);
}

function showChange(name: string, before: CaseRun[], after: CaseRun[]) {
  const from = score(before, name);
  const to = score(after, name);
  if (from === undefined || to === undefined) return "-";
  const change = Number((to - from).toFixed(2));
  const sign = change > 0 ? "+" : "";
  return `${sign}${change}${isPassFail(after, name) ? "%" : ""}`;
}

export function table(rows: string[][]) {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths?.[column] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function formatScores(result: EvalResult) {
  const names = checkNames(result.cases.flatMap((item) => item.runs));
  const header = ["case", ...names, ...failureLabels];
  const rows = result.cases.map((item) => [
    item.question,
    ...names.map((name) => show(name, item.runs)),
    ...failureLabels.map((label) => `${item.runs.filter((run) => run.failure === label).length}`),
  ]);
  return `${result.suite} on ${result.provider}, ${result.runs} run(s) per case\n${table([header, ...rows])}\n`;
}

export function formatComparison(before: EvalResult, after: EvalResult) {
  const beforeRuns = before.cases.flatMap((item) => item.runs);
  const afterRuns = after.cases.flatMap((item) => item.runs);
  const names = [...new Set([...checkNames(beforeRuns), ...checkNames(afterRuns)])];
  const rows = names.map((name) => [
    name,
    show(name, beforeRuns),
    show(name, afterRuns),
    showChange(name, beforeRuns, afterRuns),
  ]);
  return `${table([["check", "before", "after", "change"], ...rows])}\n`;
}
