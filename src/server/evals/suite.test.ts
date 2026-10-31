import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { guardPath, isOutsideRoot } from "../files/path-guard.ts";
import { loadEvalSuite, openSuiteRepo } from "./suite.ts";

const folders: string[] = [];

async function writeSuite(content: unknown) {
  const folder = await mkdtemp(join(tmpdir(), "miyagi-eval-suite-"));
  folders.push(folder);
  const file = join(folder, "suite.json");
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const validCase = {
  question: "How does saving work?",
  intent: "understand the save flow",
  mustHighlight: ["src/save.ts#save"],
  expectedOrder: ["src/save.ts#save", "src/store.ts"],
  keyFacts: ["writes a file"],
};

afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("loadEvalSuite", () => {
  it("loads a repo and its cases", async () => {
    const file = await writeSuite({ repo: "test/fixtures/basic", cases: [validCase] });
    const loaded = await loadEvalSuite(file);
    expect(loaded).toEqual({
      ok: true,
      value: { repo: "test/fixtures/basic", cases: [validCase] },
    });
  });

  it("names the file when it is missing", async () => {
    const file = join(tmpdir(), "miyagi-no-such-suite.json");
    expect(await loadEvalSuite(file)).toEqual({
      ok: false,
      error: `Eval suite not found: ${file}`,
    });
  });

  it("names the file when it is not JSON", async () => {
    const file = await writeSuite("{ nope");
    const loaded = await loadEvalSuite(file);
    expect(loaded).toEqual({ ok: false, error: `${file}\nnot valid JSON` });
  });

  it("names the file and the path of every problem in a bad suite", async () => {
    const file = await writeSuite({
      repo: "",
      cases: [{ ...validCase, mustHighlight: "src/save.ts", keyFacts: undefined }],
    });
    const loaded = await loadEvalSuite(file);
    if (loaded.ok) throw new Error("expected a failure");
    expect(loaded.error).toContain(file);
    expect(loaded.error).toContain("repo:");
    expect(loaded.error).toContain("cases.0.mustHighlight:");
    expect(loaded.error).toContain("cases.0.keyFacts:");
  });

  it("rejects a suite with no cases", async () => {
    const file = await writeSuite({ repo: "test/fixtures/basic", cases: [] });
    const loaded = await loadEvalSuite(file);
    if (loaded.ok) throw new Error("expected a failure");
    expect(loaded.error).toContain("cases:");
  });

  it("rejects unknown keys", async () => {
    const file = await writeSuite({ repo: "x", cases: [validCase], extra: true });
    expect((await loadEvalSuite(file)).ok).toBe(false);
  });

  it.each(["#symbol", "src/save.ts#", "src/save.ts#a#b", ""])(
    "rejects the highlight entry %j",
    async (entry) => {
      const file = await writeSuite({
        repo: "x",
        cases: [{ ...validCase, mustHighlight: [entry] }],
      });
      const loaded = await loadEvalSuite(file);
      if (loaded.ok) throw new Error("expected a failure");
      expect(loaded.error).toContain("cases.0.mustHighlight.0:");
    },
  );

  it("rejects a bad expectedOrder entry", async () => {
    const file = await writeSuite({
      repo: "x",
      cases: [{ ...validCase, expectedOrder: ["src/save.ts#"] }],
    });
    const loaded = await loadEvalSuite(file);
    if (loaded.ok) throw new Error("expected a failure");
    expect(loaded.error).toContain("cases.0.expectedOrder.0:");
  });
});

describe("openSuiteRepo", () => {
  it("opens a temp copy of a relative repo path, never the fixture itself", async () => {
    const opened = await openSuiteRepo("test/fixtures/basic", new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    try {
      const fixtures = resolve(import.meta.dirname, "../../../test/fixtures");
      expect(isOutsideRoot(fixtures, opened.value.root)).toBe(true);
      await expect(access(join(opened.value.root, "src/upload.ts"))).resolves.toBeUndefined();
    } finally {
      await opened.value.dispose();
    }
    await expect(access(opened.value.root)).rejects.toThrow();
  });

  it("resolves a relative repo path against the project root, not the cwd", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "miyagi-eval-cwd-"));
    folders.push(elsewhere);
    const cwd = process.cwd();
    process.chdir(elsewhere);
    try {
      const opened = await openSuiteRepo("test/fixtures/basic", new AbortController().signal);
      if (!opened.ok) throw new Error(opened.error);
      await expect(access(join(opened.value.root, "src/upload.ts"))).resolves.toBeUndefined();
      await opened.value.dispose();
    } finally {
      process.chdir(cwd);
    }
  });

  it("keeps an in-repo relative symlink pointing inside the copy", async ({ skip }) => {
    const repo = await mkdtemp(join(tmpdir(), "miyagi-eval-link-"));
    folders.push(repo);
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "src", "real.ts"), "export const real = true;\n");
    try {
      await symlink("real.ts", join(repo, "src", "link.ts"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }
    const opened = await openSuiteRepo(repo, new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    try {
      expect((await guardPath(opened.value.root, "src/link.ts")).ok).toBe(true);
    } finally {
      await opened.value.dispose();
    }
  });

  it("reports a missing local repo", async () => {
    const opened = await openSuiteRepo("test/fixtures/missing", new AbortController().signal);
    expect(opened.ok).toBe(false);
  });

  it("refuses a git URL that is not a public GitHub repo, without cloning", async () => {
    const opened = await openSuiteRepo("https://example.com/a/b", new AbortController().signal);
    expect(opened).toEqual({
      ok: false,
      error: "Only https://github.com/<owner>/<repo> URLs can be cloned: https://example.com/a/b",
    });
  });
});
