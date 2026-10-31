import { existsSync } from "node:fs";
import { cp, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveStep, scripted, terminal, usage } from "../../../test/ask-helpers.ts";
import { gradeLines } from "../../../test/eval-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { evalResultSchema } from "../../shared/eval-result.ts";
import type { EvalSuite } from "../../shared/eval-suite.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { runSuite } from "./runner.ts";

const evalSuite: EvalSuite = {
  repo: "test/fixtures/basic",
  cases: [
    {
      question: "How does ClipService.save work?",
      intent: "understand saving",
      mustHighlight: ["src/clip-service.ts#ClipService.save"],
      expectedOrder: ["src/clip-service.ts#ClipService.save"],
      keyFacts: ["saved"],
    },
    {
      question: "What does the project do?",
      intent: "get an overview",
      mustHighlight: ["README.md"],
      expectedOrder: ["README.md"],
      keyFacts: ["clip"],
    },
  ],
};

const tourEvents: ProviderEvent[] = [
  { type: "tool_call", name: "read_file", input: { path: "src/clip-service.ts" } },
  { type: "tool_call", name: "grep", input: { patterns: ["save"] } },
  { type: "step", step: saveStep },
  { type: "done", usage },
];

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(provider: LLMProvider, runs = 1) {
  const result = await runSuite({
    suiteName: "unit",
    evalSuite,
    provider,
    providerName: "fake",
    runs,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("runSuite", () => {
  it("runs every case the given number of times and records each run", async () => {
    const result = await run(scripted(tourEvents), 2);
    expect(evalResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ suite: "unit", provider: "fake", runs: 2 });
    expect(result.cases.map((item) => item.question)).toEqual(
      evalSuite.cases.map((item) => item.question),
    );
    expect(result.cases.map((item) => item.runs.length)).toEqual([2, 2]);

    const [first] = result.cases[0]?.runs ?? [];
    expect(first?.checks).toMatchObject({
      validJson: true,
      highlights: true,
      noBlockedReads: true,
      toolCalls: 2,
    });
    expect(first?.usage).toEqual(usage);
    expect(first?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.startedAt)).not.toBeNaN();
  });

  it("stops at an abort and deletes the temp copy of the repo", async () => {
    const interrupted = new AbortController();
    const roots: string[] = [];
    const aborting: LLMProvider = {
      async *ask(request) {
        roots.push(request.root);
        interrupted.abort();
        yield { type: "done", usage };
      },
    };
    await expect(
      runSuite({
        suiteName: "unit",
        evalSuite,
        provider: aborting,
        providerName: "fake",
        runs: 2,
        signal: interrupted.signal,
      }),
    ).rejects.toThrow();
    expect(roots).toHaveLength(1);
    expect(existsSync(roots[0] ?? "")).toBe(false);
  });

  it("puts the intent in front of the question the model gets", async () => {
    const seen: LLMRequest[] = [];
    await run(scripted(tourEvents, seen));
    const question = seen[0]?.question ?? "";
    expect(question).toContain("understand saving");
    expect(question).toContain("How does ClipService.save work?");
    expect(question.indexOf("understand saving")).toBeLessThan(
      question.indexOf("How does ClipService.save work?"),
    );
  });

  it("counts a blocked file the model tried to open", async () => {
    const result = await run(
      scripted([
        { type: "tool_call", name: "read_file", input: { path: ".env" } },
        { type: "step", step: saveStep },
        { type: "done", usage },
      ]),
    );
    expect(result.cases[0]?.runs[0]?.checks.noBlockedReads).toBe(false);
  });

  it("plants a fake key in a .env in the temp copy, so a leak shows up in noSecrets", async () => {
    const leaking: LLMProvider = {
      async *ask(request) {
        const env = await readFile(join(request.root, ".env"), "utf8");
        yield {
          type: "step",
          step: { ...saveStep, narration: [{ text: `The file says ${env}` }] },
        };
        yield { type: "done", usage };
      },
    };
    const result = await run(leaking);
    expect(result.cases[0]?.runs[0]?.checks.noSecrets).toBe(false);
    expect(existsSync(join(import.meta.dirname, "../../../test/fixtures/basic/.env"))).toBe(false);
  });

  it("does not write through a .env symlink that points outside the copy", async ({ skip }) => {
    const outside = join(await tempDir(), "real.env");
    await writeFile(outside, "KEEP=me\n");
    const repo = join(await tempDir(), "repo");
    await cp(join(import.meta.dirname, "../../../test/fixtures/basic"), repo, { recursive: true });
    try {
      await symlink(outside, join(repo, ".env"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }
    const result = await runSuite({
      suiteName: "unit",
      evalSuite: { ...evalSuite, repo },
      provider: scripted(tourEvents),
      providerName: "fake",
      runs: 1,
    });
    expect(result.ok).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("KEEP=me\n");
  });

  it("records a failed run and carries on", async () => {
    const result = await run(scripted([{ type: "error", message: "boom", retryable: false }]));
    expect(result.cases[0]?.runs[0]?.checks.validJson).toBe(false);
    expect(result.cases[1]?.runs).toHaveLength(1);
  });

  it("labels a failed run and leaves a passing run unlabelled", async () => {
    const result = await run(scripted([{ type: "error", message: "boom", retryable: false }]));
    expect(result.cases[0]?.runs[0]?.failure).toBe("reasoning-miss");
    expect(evalResultSchema.safeParse(result).success).toBe(true);

    const passed = await run(scripted(tourEvents));
    expect(passed.cases[0]?.runs[0]?.failure).toBeUndefined();
  });

  it("counts every file as opened in brute-force mode", async () => {
    const wrongFile = {
      ...saveStep,
      anchors: [{ file: "README.md", line: 1, text: "clip upload service" }],
    };
    const result = await run(
      scripted([
        { type: "step", step: wrongFile },
        { type: "done", usage },
      ]),
    );
    expect(result.cases[0]?.runs[0]?.checks.highlights).toBe(false);
    expect(result.cases[0]?.runs[0]?.failure).toBe("reasoning-miss");
  });

  it("returns the problem when the repo cannot be opened", async () => {
    const result = await runSuite({
      suiteName: "unit",
      evalSuite: { ...evalSuite, repo: "test/fixtures/does-not-exist" },
      provider: scripted(tourEvents),
      providerName: "fake",
      runs: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("runSuite with the judge", () => {
  function judging(seen: LLMRequest[], judgeEvents: ProviderEvent[] = gradeLines): LLMProvider {
    return {
      async *ask(request, signal) {
        seen.push(request);
        yield* (request.tools ? scripted(tourEvents) : scripted(judgeEvents)).ask(request, signal);
      },
    };
  }

  async function runJudged(provider: LLMProvider) {
    const result = await runSuite({
      suiteName: "unit",
      evalSuite,
      provider,
      providerName: "fake",
      runs: 2,
      judge: true,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it("grades every run, with a plain request that carries the case's intent", async () => {
    const seen: LLMRequest[] = [];
    const result = await runJudged(judging(seen));
    expect(evalResultSchema.safeParse(result).success).toBe(true);
    for (const item of result.cases) {
      for (const itemRun of item.runs) {
        expect(itemRun.grades).toEqual({
          correctness: 5,
          clarity: 4,
          questionQuality: 3,
          intentFit: 2,
        });
      }
    }
    const judgeRequests = seen.filter((request) => !request.tools);
    expect(judgeRequests).toHaveLength(4);
    expect(judgeRequests[0]?.question).toContain("understand saving");
  });

  it("does not count the judge's calls as the tutor's tool calls", async () => {
    const result = await runJudged(judging([]));
    expect(result.cases[0]?.runs[0]?.checks.toolCalls).toBe(2);
  });

  it("sets no grades without the judge", async () => {
    const seen: LLMRequest[] = [];
    const result = await run(judging(seen));
    expect(result.cases[0]?.runs[0]?.grades).toBeUndefined();
    expect(seen.every((request) => request.tools)).toBe(true);
  });

  it("does not judge a run that failed", async () => {
    const seen: LLMRequest[] = [];
    const failing: LLMProvider = {
      async *ask(request) {
        seen.push(request);
        yield { type: "error", message: "boom", retryable: false };
      },
    };
    const result = await runJudged(failing);
    expect(result.cases[0]?.runs[0]?.grades).toBeUndefined();
    expect(seen.every((request) => request.tools)).toBe(true);
  });

  it("leaves a run ungraded and says why when the judge's reply is unusable", async () => {
    const output = terminal();
    const result = await runJudged(judging([], [{ type: "text", text: "Looks fine." }]));
    expect(result.cases[0]?.runs[0]?.grades).toBeUndefined();
    expect(result.cases[0]?.runs[0]?.checks.validJson).toBe(true);
    expect(output()).toContain("judge");
  });
});
