import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitAll, createRepo, git } from "../../../test/git-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { gitTool } from "./git.ts";

describe("gitTool", () => {
  it("shows uncommitted changes with diff HEAD", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("diff --git a/src/upload.ts b/src/upload.ts");
    expect(result.text).toContain("-export const limit = 1");
    expect(result.text).toContain("+export const limit = 2");
  });

  it("shows a commit with show and lists commits with log", async () => {
    const root = await createRepo();

    const shown = await gitTool(root, { command: "show", args: ["HEAD", "--stat"] });
    const logged = await gitTool(root, { command: "log", args: ["--oneline", "-n", "1"] });

    expect(shown.text).toContain("add upload");
    expect(shown.text).toContain("src/upload.ts");
    expect(logged.text).toMatch(/^[0-9a-f]+ add upload$/);
  });

  it("limits a diff to the paths after --", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");
    await writeFile(join(root, "src", "old.ts"), "export const old = false\n");

    const result = await gitTool(root, {
      command: "diff",
      args: ["HEAD", "--name-only", "--", "src/old.ts"],
    });

    expect(result.text).toBe("src/old.ts");
  });

  it("refuses commands other than diff, show and log", async () => {
    const root = await createRepo();

    for (const command of ["push", "commit", "config", "checkout"]) {
      const result = await gitTool(root, { command, args: [] });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^Invalid git input/);
    }
  });

  it.each([
    ["-c", "core.pager=sh"],
    ["--output=stolen.txt"],
    ["--no-index"],
    ["--ext-diff"],
    ["--textconv"],
    ["--exec-path=/tmp"],
    ["-O/tmp/orderfile"],
    ["-n", "0"],
    ["-n", "201"],
    ["HEAD:.env"],
    ["HEAD^{tree}"],
    ["HEAD^@"],
  ])("refuses the arguments %s", async (...args) => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await gitTool(root, { command: "diff", args });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Invalid git input/);
    expect(existsSync(join(root, "stolen.txt"))).toBe(false);
  });

  it.each([
    ["absolute path", "/etc/passwd"],
    ["Windows drive path", "C:\\Windows\\win.ini"],
    ["parent folder", "../outside.ts"],
    ["Windows parent folder", "src\\..\\..\\outside.ts"],
    ["pathspec magic", ":(top)src"],
  ])("refuses a %s after --", async (_name, path) => {
    const root = await createRepo();

    const result = await gitTool(root, { command: "diff", args: ["HEAD", "--", path] });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Invalid git input/);
  });

  it("refuses more than 20 arguments", async () => {
    const root = await createRepo();

    const result = await gitTool(root, { command: "log", args: Array(21).fill("HEAD") });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/^Invalid git input/);
  });

  it("does not run commands named in the repository's git config", async () => {
    const root = await createRepo();
    git(root, "config", "diff.external", "touch external-ran");
    git(root, "config", "core.fsmonitor", "touch fsmonitor-ran");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result.text).toContain("+export const limit = 2");
    expect(existsSync(join(root, "external-ran"))).toBe(false);
    expect(existsSync(join(root, "fsmonitor-ran"))).toBe(false);
  });

  it("caps long output at 200 lines and says how many were left out", async () => {
    const root = await createRepo();
    const lines = Array.from(
      { length: 500 },
      (_, index) => `export const value${index} = ${index}`,
    );
    await writeFile(join(root, "src", "upload.ts"), `${lines.join("\n")}\n`);

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    const shown = result.text.split("\n");
    expect(shown).toHaveLength(201);
    expect(shown.at(-1)).toMatch(/^\d+ more lines$/);
    expect(result.text).toContain("+export const value10 = 10");
    expect(result.text).not.toContain("+export const value400 = 400");
  });

  it("returns the first 200 lines of output too big to read whole", async () => {
    const root = await createRepo();
    const padding = "x".repeat(100);
    const content = Array.from(
      { length: 7000 },
      (_, index) => `export const value${index} = "${padding}"`,
    ).join("\n");
    await Promise.all(
      [0, 1, 2, 3].map((index) => writeFile(join(root, "src", `big${index}.ts`), content)),
    );
    commitAll(root, "add big files");

    const result = await gitTool(root, { command: "show", args: ["HEAD"] });

    const shown = result.text.split("\n");
    expect(result.isError).toBe(false);
    expect(shown).toHaveLength(201);
    expect(shown.at(-1)).toBe("More lines were cut");
  });

  it("returns git's message as an error result for an unknown revision", async () => {
    const root = await createRepo();

    const result = await gitTool(root, { command: "show", args: ["nosuchrevision"] });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("nosuchrevision");
  });

  it("returns a readable error outside a git repository", async () => {
    const root = await tempDir();

    const result = await gitTool(root, { command: "log", args: [] });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("not a git repository");
  });

  it("says when there is nothing to show", async () => {
    const root = await createRepo();

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result).toEqual({ isError: false, text: "No changes." });
  });
});
