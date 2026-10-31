import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { redact } from "../files/redact.ts";
import { loadEvalSuite, openSuiteRepo } from "./suite.ts";

const projectRoot = resolve(import.meta.dirname, "../../..");

async function loadSuite(name: string) {
  const loaded = await loadEvalSuite(join(projectRoot, "evals", `${name}.json`));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

async function resolvesInRepo(root: string, reference: string) {
  const [file = "", symbol] = reference.split("#");
  const resolved = symbol
    ? await resolveAnchor(root, { file, symbol })
    : await readRedactedFile(root, file);
  return resolved.ok;
}

async function textFiles(folder: string) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
  );
}

describe.each(["fixtures", "injection"])("the %s suite", (name) => {
  it("only points at files and symbols that exist in its repo", async () => {
    const suite = await loadSuite(name);
    const opened = await openSuiteRepo(suite.repo, new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    try {
      for (const testCase of suite.cases) {
        expect(testCase.mustHighlight.length).toBeGreaterThan(0);
        expect(testCase.expectedOrder.length).toBeGreaterThan(0);
        expect(testCase.keyFacts.length).toBeGreaterThan(0);
        for (const reference of [...testCase.mustHighlight, ...testCase.expectedOrder]) {
          expect(await resolvesInRepo(opened.value.root, reference), reference).toBe(true);
        }
      }
    } finally {
      await opened.value.dispose();
    }
  });
});

describe("the fixtures suite", () => {
  it("has 5 cases over test/fixtures/basic", async () => {
    const suite = await loadSuite("fixtures");
    expect(suite.repo).toBe("test/fixtures/basic");
    expect(suite.cases).toHaveLength(5);
  });
});

describe("the injection suite", () => {
  it("runs over test/fixtures/injection", async () => {
    const suite = await loadSuite("injection");
    expect(suite.repo).toBe("test/fixtures/injection");
  });

  it("expects the tour to flag the planted comment in the files each case highlights", async () => {
    const suite = await loadSuite("injection");
    for (const testCase of suite.cases) {
      const files = testCase.mustHighlight.map((reference) => reference.split("#")[0] ?? "");
      const texts = await Promise.all(
        files.map((file) => readFile(join(projectRoot, suite.repo, file), "utf8")),
      );
      const plantedLines = texts
        .flatMap((text) => text.split(/\r?\n/))
        .filter((line) => line.trimStart().startsWith("//"))
        .join("\n")
        .toLowerCase();
      expect(plantedLines, testCase.question).toMatch(/\.env/);
      for (const fact of testCase.keyFacts) {
        expect(plantedLines, fact).toContain(fact.toLowerCase());
      }
    }
  });

  it("plants no real secret, so any redaction in an answer is a leak", async () => {
    const suite = await loadSuite("injection");
    for (const text of await textFiles(join(projectRoot, suite.repo))) {
      expect(redact(text)).toBe(text);
    }
  });
});
