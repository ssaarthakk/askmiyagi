import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallRecord } from "../../shared/call-log.ts";
import { type CaseRun, type EvalResult, evalResultSchema } from "../../shared/eval-result.ts";
import type { EvalCase, EvalSuite } from "../../shared/eval-suite.ts";
import type { AskEvent } from "../../shared/events.ts";
import { ackPhrases } from "../../shared/phrases.ts";
import type { Profile } from "../../shared/profile.ts";
import type { Result } from "../../shared/result.ts";
import { usageSchema } from "../../shared/usage.ts";
import { askEvents } from "../llm/ask.ts";
import { createConversation } from "../llm/conversation.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { logError } from "../log.ts";
import { isUrl } from "../source/github-url.ts";
import { runCodeChecks } from "./code-checks.ts";
import { classifyFailure } from "./failure.ts";
import { judgeRun } from "./judge.ts";
import { readJsonFile } from "./read-json.ts";
import { openSuiteRepo } from "./suite.ts";

type RunSuiteOptions = {
  suiteName: string;
  evalSuite: EvalSuite;
  provider: LLMProvider;
  providerName: string;
  runs: number;
  judge?: boolean | undefined;
  mode?: Profile["mode"] | undefined;
  signal?: AbortSignal | undefined;
};

const fakeKeyFile = "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\n";

async function runCase(
  root: string,
  evalCase: EvalCase,
  options: RunSuiteOptions,
  signal: AbortSignal,
): Promise<CaseRun> {
  let toolCalls = 0;
  let questionInAnswerMode = false;
  const provider: LLMProvider = {
    async *ask(request, askSignal) {
      for await (const event of options.provider.ask(request, askSignal)) {
        if (event.type === "tool_call") toolCalls += 1;
        if (event.type === "checkQuestion" && options.mode === "answer") {
          questionInAnswerMode = true;
        }
        yield event;
      }
    },
  };
  const logged: { record?: CallRecord } = {};
  const events: AskEvent[] = [];
  const started = performance.now();
  for await (const event of askEvents({
    root,
    provider,
    conversation: createConversation(),
    question: `Intent: ${evalCase.intent}\n${evalCase.question}`,
    ack: ackPhrases[0] ?? "",
    mode: options.mode,
    signal,
    callLog: {
      provider: options.providerName,
      write: async (record) => {
        logged.record = record;
      },
    },
  })) {
    events.push(event);
  }
  signal.throwIfAborted();
  const durationMs = performance.now() - started;
  if (!logged.record) throw new Error("The ask finished without a call record");
  const { filesOpened, mode } = logged.record;
  const usage = usageSchema.parse(logged.record);
  const checks = await runCodeChecks(root, evalCase, {
    events,
    filesOpened,
    toolCalls,
    usage,
    durationMs,
    questionInAnswerMode,
  });
  const failure = await classifyFailure(root, evalCase, { checks, filesOpened, mode });
  const scored = { checks, ...(failure && { failure }), usage, durationMs };
  const tour = events.find((event) => event.type === "tour");
  if (!options.judge || tour === undefined) return scored;
  const grades = await judgeRun({
    provider: options.provider,
    root,
    evalCase,
    tour: tour.tour,
    ranges: tour.ranges,
    signal,
  });
  signal.throwIfAborted();
  if (!grades.ok) {
    logError(`The judge could not grade "${evalCase.question}": ${grades.error}`);
    return scored;
  }
  return { ...scored, grades: grades.value };
}

export async function runSuite(options: RunSuiteOptions): Promise<Result<EvalResult>> {
  const startedAt = new Date().toISOString();
  const signal = options.signal ?? new AbortController().signal;
  const source = await openSuiteRepo(options.evalSuite.repo, signal);
  if (!source.ok) return source;
  try {
    if (!isUrl(options.evalSuite.repo)) {
      const envFile = join(source.value.root, ".env");
      await rm(envFile, { force: true });
      await writeFile(envFile, fakeKeyFile, { flag: "wx" });
    }
    const cases: EvalResult["cases"] = [];
    for (const evalCase of options.evalSuite.cases) {
      const runs: CaseRun[] = [];
      for (let index = 0; index < options.runs; index += 1) {
        runs.push(await runCase(source.value.root, evalCase, options, signal));
      }
      cases.push({ question: evalCase.question, runs });
    }
    return {
      ok: true,
      value: {
        suite: options.suiteName,
        provider: options.providerName,
        runs: options.runs,
        startedAt,
        cases,
      },
    };
  } finally {
    await source.value.dispose();
  }
}

export async function writeResult(folder: string, result: EvalResult) {
  await mkdir(folder, { recursive: true });
  const file = join(folder, `${result.startedAt.replaceAll(":", "-")}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}

export function readResult(file: string) {
  return readJsonFile(file, evalResultSchema, "Eval result");
}
