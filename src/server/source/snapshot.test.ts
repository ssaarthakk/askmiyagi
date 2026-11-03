import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRepo, git } from "../../../test/git-helpers.ts";
import { createSnapshot, diffAgainstSnapshot } from "./snapshot.ts";

const snapshotFolder = (root: string) => join(root, ".tutor", "private", "snapshot");
const signal = () => AbortSignal.timeout(30_000);

describe("createSnapshot", () => {
  it("copies the visible files and leaves out hidden ones", async () => {
    const root = await createRepo();

    const result = await createSnapshot(root);

    expect(result).toEqual({ ok: true, value: 2 });
    expect(await readFile(join(snapshotFolder(root), "src", "upload.ts"), "utf8")).toBe(
      "export const limit = 1\n",
    );
    expect(existsSync(join(snapshotFolder(root), "src", "old.ts"))).toBe(true);
    expect(existsSync(join(snapshotFolder(root), ".env"))).toBe(false);
    expect(existsSync(join(snapshotFolder(root), "package-lock.json"))).toBe(false);
  });

  it("replaces an earlier snapshot instead of adding to it", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await rm(join(root, "src", "old.ts"));

    await createSnapshot(root);

    expect(existsSync(join(snapshotFolder(root), "src", "old.ts"))).toBe(false);
    expect(existsSync(join(snapshotFolder(root), "src", "upload.ts"))).toBe(true);
  });

  it("keeps the snapshot out of git status", async () => {
    const root = await createRepo();

    await createSnapshot(root);

    expect(git(root, "status", "--porcelain", "-uall")).not.toContain("snapshot");
  });
});

describe("diffAgainstSnapshot", () => {
  it("shows a changed file as hunks with the project path on both sides", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await diffAgainstSnapshot(root, signal());

    expect(result).toEqual({
      ok: true,
      value: [
        "diff --git a/src/upload.ts b/src/upload.ts",
        "--- a/src/upload.ts",
        "+++ b/src/upload.ts",
        "@@ -1 +1 @@",
        "-export const limit = 1",
        "+export const limit = 2",
      ].join("\n"),
    });
  });

  it("shows an added file against /dev/null and a deleted file the same way", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await writeFile(join(root, "src", "new.ts"), "export const fresh = 1\n");
    await rm(join(root, "src", "old.ts"));

    const result = await diffAgainstSnapshot(root, signal());

    expect(result).toEqual({
      ok: true,
      value: [
        "diff --git a/src/new.ts b/src/new.ts",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+export const fresh = 1",
        "diff --git a/src/old.ts b/src/old.ts",
        "--- a/src/old.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-export const old = true",
      ].join("\n"),
    });
  });

  it("leaves out files the file filter hides", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await writeFile(join(root, ".env"), "TOKEN=second\n");
    await writeFile(join(root, "package-lock.json"), '{"lock":2}\n');
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "dep.js"), "module.exports = 1\n");

    const result = await diffAgainstSnapshot(root, signal());

    expect(result).toEqual({ ok: true, value: "No changes." });
  });

  it("redacts secrets in the changed lines", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    const key = `sk-ant-${"a1b2c3d4e5".repeat(4)}`;
    await writeFile(join(root, "src", "upload.ts"), `export const key = "${key}"\n`);

    const result = await diffAgainstSnapshot(root, signal());

    expect(result.ok && result.value).toContain("[REDACTED]");
    expect(result.ok && result.value).not.toContain(key);
  });

  it("asks for a snapshot when there is none", async () => {
    const root = await createRepo();

    const result = await diffAgainstSnapshot(root, signal());

    expect(result).toEqual({
      ok: false,
      error: "There is no snapshot yet. Run askmiyagi snapshot first.",
    });
  });
});
