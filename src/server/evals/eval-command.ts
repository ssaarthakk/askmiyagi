import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { modes } from "../../shared/profile.ts";
import { chooseProvider } from "../llm/choose-provider.ts";
import { formatCalibration, humanGradesSchema } from "./calibrate.ts";
import { readJsonFile } from "./read-json.ts";
import { readResult, runSuite, writeResult } from "./runner.ts";
import { formatComparison, formatScores } from "./score-table.ts";
import { loadEvalSuite, projectRoot } from "./suite.ts";

export const defaultResultsFolder = join(projectRoot, "evals", "results");

const fakeRecording = resolve(projectRoot, "test/fixtures/recordings/basic-tour.jsonl");

const runArgsSchema = z.object({
  suite: z
    .string({ error: "--suite <name> is required" })
    .regex(/^[\w-]+$/, "--suite must be a suite name such as fixtures"),
  provider: z.enum(["fake", "claude-headless"], {
    error: (issue) =>
      issue.input === undefined
        ? "--provider <fake|claude-headless> is required"
        : `Unknown provider: ${String(issue.input)}`,
  }),
  runs: z
    .string()
    .regex(/^[1-9]\d*$/, "--runs must be a positive integer")
    .transform(Number)
    .default(3),
  judge: z.boolean().optional(),
  mode: z.enum(modes, { error: "--mode must be teach or answer" }).default("teach"),
});

export function parseEvalArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      suite: { type: "string" },
      provider: { type: "string" },
      runs: { type: "string" },
      compare: { type: "boolean" },
      judge: { type: "boolean" },
      mode: { type: "string" },
      calibrate: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.calibrate) {
    const [result, grades, ...extra] = positionals;
    if (result === undefined || grades === undefined || extra.length > 0) {
      throw new Error(
        "--calibrate needs a result file and a grades file: --calibrate <result> <grades>",
      );
    }
    return { kind: "calibrate" as const, result, grades };
  }
  if (values.compare) {
    const [before, after, ...extra] = positionals;
    if (before === undefined || after === undefined || extra.length > 0) {
      throw new Error("--compare needs two result files: --compare <before> <after>");
    }
    return { kind: "compare" as const, before, after };
  }
  const parsed = runArgsSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }
  return { kind: "run" as const, ...parsed.data };
}

export async function runEval(
  args: string[],
  resultsFolder: string,
  signal = new AbortController().signal,
) {
  const parsed = parseEvalArgs(args);
  if (parsed.kind === "calibrate") {
    const result = await readResult(parsed.result);
    if (!result.ok) throw new Error(result.error);
    const humans = await readJsonFile(parsed.grades, humanGradesSchema, "Grades file");
    if (!humans.ok) throw new Error(humans.error);
    return formatCalibration(result.value, humans.value);
  }
  if (parsed.kind === "compare") {
    const [before, after] = await Promise.all([
      readResult(parsed.before),
      readResult(parsed.after),
    ]);
    if (!before.ok) throw new Error(before.error);
    if (!after.ok) throw new Error(after.error);
    return formatComparison(before.value, after.value);
  }

  const evalSuite = await loadEvalSuite(resolve(projectRoot, "evals", `${parsed.suite}.json`));
  if (!evalSuite.ok) throw new Error(evalSuite.error);
  const provider = await chooseProvider({
    provider: parsed.provider,
    recording: fakeRecording,
  });
  if (!provider.ok) throw new Error(provider.error);
  const result = await runSuite({
    suiteName: parsed.suite,
    evalSuite: evalSuite.value,
    provider: provider.value,
    providerName: parsed.provider,
    runs: parsed.runs,
    judge: parsed.judge,
    mode: parsed.mode,
    signal,
  });
  if (!result.ok) throw new Error(result.error);
  const file = await writeResult(resultsFolder, result.value);
  return `${formatScores(result.value)}\nSaved ${file}\n`;
}
