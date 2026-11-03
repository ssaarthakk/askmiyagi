import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitAll, createRepo, git } from "../../../test/git-helpers.ts";
import { gitTool } from "./git.ts";

const fakeKey = "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gitTool hiding", () => {
  it("drops files the file filter hides from patches and file lists", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    await writeFile(join(root, "package-lock.json"), '{"lock":2}\n');

    const patch = await gitTool(root, { command: "diff", args: ["HEAD"] });
    const names = await gitTool(root, { command: "diff", args: ["HEAD", "--name-only"] });
    const status = await gitTool(root, { command: "diff", args: ["HEAD", "--name-status"] });
    const stat = await gitTool(root, { command: "diff", args: ["HEAD", "--stat"] });

    expect(patch.text).toContain("src/upload.ts");
    expect(names.text).toBe("src/upload.ts");
    expect(status.text).toBe("M\tsrc/upload.ts");
    expect(stat.text).toContain("src/upload.ts");
    for (const output of [patch.text, names.text, status.text, stat.text]) {
      expect(output).not.toContain(".env");
      expect(output).not.toContain("TOKEN");
      expect(output).not.toContain("package-lock");
    }
  });

  it("shows a deleted source file but hides a deleted secret file", async () => {
    const root = await createRepo();
    await unlink(join(root, "src", "old.ts"));
    await unlink(join(root, ".env"));

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });
    const status = await gitTool(root, { command: "diff", args: ["HEAD", "--name-status"] });

    expect(result.text).toContain("diff --git a/src/old.ts b/src/old.ts");
    expect(result.text).toContain("-export const old = true");
    expect(result.text).not.toContain("TOKEN");
    expect(status.text).toBe("D\tsrc/old.ts");
  });

  it("keeps the commit message and hides the secret when a commit changes both kinds of file", async () => {
    const root = await createRepo();
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 3\n");
    commitAll(root, "rotate token and raise limit");

    const result = await gitTool(root, { command: "show", args: ["HEAD"] });

    expect(result.text).toContain("rotate token and raise limit");
    expect(result.text).toContain("+export const limit = 3");
    expect(result.text).not.toContain("TOKEN");
  });

  it("leaves out a commit that only changed hidden files", async () => {
    const root = await createRepo();
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    commitAll(root, "rotate token");

    const shown = await gitTool(root, { command: "show", args: ["HEAD"] });
    const logged = await gitTool(root, { command: "log", args: ["--oneline"] });

    expect(shown).toEqual({ isError: false, text: "No changes." });
    expect(logged.text).not.toContain("rotate token");
    expect(logged.text).toContain("add upload");
  });

  it("hides secrets in an older commit that a count reaches once hidden-only commits are left out", async () => {
    const root = await createRepo();
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    commitAll(root, "rotate token");

    const patch = await gitTool(root, { command: "log", args: ["-U3", "-n", "1"] });
    const names = await gitTool(root, { command: "log", args: ["--name-only", "-n", "1"] });

    expect(patch.text).toContain("+export const limit = 1");
    expect(names.text).toContain("src/upload.ts");
    for (const output of [patch.text, names.text]) {
      expect(output).not.toContain("package-lock");
      expect(output).not.toContain("TOKEN");
    }
  });

  it("refuses to read a hidden file's blob by its hash", async () => {
    const root = await createRepo();
    const envBlob = git(root, "rev-parse", "HEAD:.env").trim();
    const lockBlob = git(root, "rev-parse", "HEAD:package-lock.json").trim();

    const shown = await gitTool(root, { command: "show", args: [envBlob] });
    const diffed = await gitTool(root, { command: "diff", args: [envBlob, lockBlob] });

    for (const result of [shown, diffed]) {
      expect(result.isError).toBe(true);
      expect(result.text).not.toContain("TOKEN");
      expect(result.text).not.toContain("lock");
    }
  });

  it("still hides files when GIT_LITERAL_PATHSPECS is set", async () => {
    const root = await createRepo();
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    vi.stubEnv("GIT_LITERAL_PATHSPECS", "1");

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result.text).not.toContain("TOKEN");
  });

  it("refuses a change with too many hidden files to exclude", async () => {
    const root = await createRepo();
    await mkdir(join(root, "build"));
    const names = Array.from(
      { length: 500 },
      (_, index) => `build/generated-file-name-number-${index}.txt`,
    );
    await Promise.all(names.map((name) => writeFile(join(root, name), "one\n")));
    commitAll(root, "add build output");
    await Promise.all(names.map((name) => writeFile(join(root, name), "two\n")));

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("narrow it with paths after --");
  });

  it("redacts secrets in the output", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), `export const note = "${fakeKey}"\n`);

    const result = await gitTool(root, { command: "diff", args: ["HEAD"] });

    expect(result.text).toContain("[REDACTED]");
    expect(result.text).not.toContain(fakeKey);
  });
});
