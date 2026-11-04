import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal, usage } from "../../../test/ask-helpers.ts";
import { resultOf } from "../../../test/eval-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { defaultResultsFolder, parseEvalArgs, runEval } from "./eval-command.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseEvalArgs", () => {
  it("runs 3 times by default", () => {
    expect(parseEvalArgs(["--suite", "fixtures", "--provider", "fake"])).toEqual({
      kind: "run",
      suite: "fixtures",
      provider: "fake",
      runs: 3,
      mode: "teach",
    });
  });

  it("reads --mode teach|answer", () => {
    const base = ["--suite", "fixtures", "--provider", "fake"];
    expect(parseEvalArgs([...base, "--mode", "answer"])).toMatchObject({ mode: "answer" });
    expect(parseEvalArgs([...base, "--mode", "teach"])).toMatchObject({ mode: "teach" });
  });

  it("refuses an unknown --mode", () => {
    expect(() =>
      parseEvalArgs(["--suite", "fixtures", "--provider", "fake", "--mode", "quiz"]),
    ).toThrow("--mode");
  });

  it("reads --runs", () => {
    const parsed = parseEvalArgs([
      "--suite",
      "fixtures",
      "--provider",
      "claude-headless",
      "--runs",
      "5",
    ]);
    expect(parsed).toMatchObject({ provider: "claude-headless", runs: 5 });
  });

  it("reads --judge", () => {
    expect(parseEvalArgs(["--suite", "fixtures", "--provider", "fake", "--judge"])).toMatchObject({
      kind: "run",
      judge: true,
    });
  });

  it("reads --calibrate with a result file and a grades file", () => {
    expect(parseEvalArgs(["--calibrate", "result.json", "grades.json"])).toEqual({
      kind: "calibrate",
      result: "result.json",
      grades: "grades.json",
    });
  });

  it("reads --compare with two result files", () => {
    expect(parseEvalArgs(["--compare", "a.json", "b.json"])).toEqual({
      kind: "compare",
      before: "a.json",
      after: "b.json",
    });
  });

  it.each([
    [["--provider", "fake"], "--suite"],
    [["--suite", "fixtures"], "--provider"],
    [["--suite", "fixtures", "--provider", "gpt"], "Unknown provider: gpt"],
    [["--suite", "fixtures", "--provider", "fake", "--runs", "0"], "--runs"],
    [["--suite", "fixtures", "--provider", "fake", "--runs", "many"], "--runs"],
    [["--suite", "../secret", "--provider", "fake"], "--suite"],
    [["--compare", "a.json"], "two result files"],
    [["--compare", "a.json", "b.json", "c.json"], "two result files"],
    [["--calibrate", "a.json"], "a result file and a grades file"],
    [["--calibrate", "a.json", "b.json", "c.json"], "a result file and a grades file"],
  ])("rejects %j", (args, message) => {
    expect(() => parseEvalArgs(args)).toThrow(message);
  });
});

describe("runEval", () => {
  it.each(["fixtures", "injection"])(
    "runs the %s suite on the fake provider, saves the result and prints every code check",
    async (suite) => {
      const folder = await tempDir();
      const output = await runEval(["--suite", suite, "--provider", "fake", "--runs", "1"], folder);
      for (const name of [
        "highlights",
        "startingPoint",
        "flowOrder",
        "validJson",
        "anchorFailureRate",
        "noCodeInNarration",
        "questionsOnlyAtEnd",
        "noBlockedReads",
        "noSecrets",
        "keyFacts",
        "latencyMs",
        "costUsd",
        "toolCalls",
        "retrieval-miss",
        "reasoning-miss",
      ]) {
        expect(output).toContain(name);
      }
      expect(await readdir(folder)).toHaveLength(1);
    },
  );

  it("has the judge grade the runs when --judge is given", async () => {
    const judged = terminal();
    await runEval(
      ["--suite", "fixtures", "--provider", "fake", "--runs", "1", "--judge"],
      await tempDir(),
    );
    expect(judged()).toContain("The judge could not grade");
  });

  it("does not call the judge without --judge", async () => {
    const unjudged = terminal();
    await runEval(["--suite", "fixtures", "--provider", "fake", "--runs", "1"], await tempDir());
    expect(unjudged()).not.toContain("The judge could not grade");
  });

  it("compares two saved results", async () => {
    const folder = await tempDir();
    await runEval(["--suite", "fixtures", "--provider", "fake", "--runs", "1"], folder);
    const [file = ""] = await readdir(folder);
    const output = await runEval(["--compare", join(folder, file), join(folder, file)], folder);
    expect(output).toMatch(/highlights\s+(\d+)%\s+\1%\s+0%/);
  });

  it("prints how far the judge's grades agree with human grades", async () => {
    const folder = await tempDir();
    const grades = { correctness: 4, clarity: 4, questionQuality: 4, intentFit: 4 };
    const result = resultOf([
      { question: "Q", runs: [{ checks: {}, grades, usage, durationMs: 1 }] },
    ]);
    await writeFile(join(folder, "result.json"), JSON.stringify(result));
    await writeFile(join(folder, "grades.json"), JSON.stringify([{ case: 0, ...grades }]));
    const output = await runEval(
      ["--calibrate", join(folder, "result.json"), join(folder, "grades.json")],
      folder,
    );
    expect(output).toMatch(/correctness\s+1\/1\s+1\/1/);
  });

  it.each([
    ["not valid JSON", "{", "not valid JSON"],
    ["the wrong shape", "[{}]", "case"],
  ])("fails clearly when the grades file is %s", async (_name, content, message) => {
    const folder = await tempDir();
    await runEval(["--suite", "fixtures", "--provider", "fake", "--runs", "1"], folder);
    const [file = ""] = await readdir(folder);
    await writeFile(join(folder, "grades.json"), content);
    await expect(
      runEval(["--calibrate", join(folder, file), join(folder, "grades.json")], folder),
    ).rejects.toThrow(message);
  });

  it("fails with a clear message for an unknown suite", async () => {
    await expect(
      runEval(["--suite", "nope", "--provider", "fake"], await tempDir()),
    ).rejects.toThrow("Eval suite not found");
  });
});

describe("defaultResultsFolder", () => {
  it("is evals/results in the Miyagi project", () => {
    expect(defaultResultsFolder).toBe(resolve(import.meta.dirname, "../../../evals/results"));
  });
});
