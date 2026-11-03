import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitAll, createRepo, git } from "../../../test/git-helpers.ts";
import { diffAgainstBase, readBaseFile } from "./diff-base.ts";
import { createSnapshot } from "./snapshot.ts";

async function addFeatureCommit(root: string) {
  git(root, "switch", "-q", "-c", "feature");
  await writeFile(join(root, "src", "upload.ts"), "export const limit = 5\n");
  commitAll(root, "raise limit");
}

describe("diffAgainstBase", () => {
  it("shows the uncommitted changes since the last commit", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");
    await writeFile(join(root, ".env"), "TOKEN=second\n");

    const result = await diffAgainstBase(root, "uncommitted");

    expect(result.ok && result.value).toContain("+export const limit = 2");
    expect(result.ok && result.value).not.toContain("TOKEN");
  });

  it("shows a branch against main", async () => {
    const root = await createRepo();
    await addFeatureCommit(root);

    const result = await diffAgainstBase(root, "branch");

    expect(result.ok && result.value).toContain("-export const limit = 1");
    expect(result.ok && result.value).toContain("+export const limit = 5");
  });

  it("falls back to master when there is no main", async () => {
    const root = await createRepo();
    git(root, "branch", "-m", "master");
    await addFeatureCommit(root);

    const result = await diffAgainstBase(root, "branch");

    expect(result.ok && result.value).toContain("+export const limit = 5");
  });

  it("prefers origin/HEAD over a local main", async () => {
    const root = await createRepo();
    git(root, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 3\n");
    commitAll(root, "raise limit on main");
    git(root, "switch", "-q", "-c", "feature");
    await writeFile(join(root, "src", "old.ts"), "export const old = false\n");
    commitAll(root, "flip old");

    const result = await diffAgainstBase(root, "branch");

    expect(result.ok && result.value).toContain("+export const limit = 3");
    expect(result.ok && result.value).toContain("+export const old = false");
  });

  it("says so when no default branch exists", async () => {
    const root = await createRepo();
    git(root, "branch", "-m", "develop");

    const result = await diffAgainstBase(root, "branch");

    expect(result).toEqual({
      ok: false,
      error: "No default branch found: tried origin/HEAD, main and master.",
    });
  });

  it("compares with the snapshot when the base is a snapshot", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 9\n");

    const result = await diffAgainstBase(root, "snapshot");

    expect(result.ok && result.value).toContain("+export const limit = 9");
  });
});

describe("readBaseFile", () => {
  it("reads the last committed version while the working copy has changed", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await readBaseFile(root, "uncommitted", "src/upload.ts");

    expect(result).toEqual({
      ok: true,
      value: { relPath: "src/upload.ts", source: "export const limit = 1\n" },
    });
  });

  it("reads a file that has been deleted since", async () => {
    const root = await createRepo();
    await rm(join(root, "src", "old.ts"));

    const result = await readBaseFile(root, "uncommitted", "src\\old.ts");

    expect(result).toEqual({
      ok: true,
      value: { relPath: "src/old.ts", source: "export const old = true\n" },
    });
  });

  it("reads the version at the start of the branch", async () => {
    const root = await createRepo();
    await addFeatureCommit(root);

    const result = await readBaseFile(root, "branch", "src/upload.ts");

    expect(result.ok && result.value.source).toBe("export const limit = 1\n");
  });

  it("reads the branch start even after the default branch has moved on", async () => {
    const root = await createRepo();
    git(root, "switch", "-q", "-c", "feature");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 5\n");
    commitAll(root, "raise limit");
    git(root, "switch", "-q", "main");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 3\n");
    commitAll(root, "raise limit on main");
    git(root, "switch", "-q", "feature");

    const result = await readBaseFile(root, "branch", "src/upload.ts");

    expect(result.ok && result.value.source).toBe("export const limit = 1\n");
  });

  it("says so when no default branch exists", async () => {
    const root = await createRepo();
    git(root, "branch", "-m", "develop");

    const result = await readBaseFile(root, "branch", "src/upload.ts");

    expect(result).toEqual({
      ok: false,
      error: "No default branch found: tried origin/HEAD, main and master.",
    });
  });

  it("reads the snapshot copy", async () => {
    const root = await createRepo();
    await createSnapshot(root);
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 9\n");

    const result = await readBaseFile(root, "snapshot", "src/upload.ts");

    expect(result.ok && result.value.source).toBe("export const limit = 1\n");
  });

  it("says so when the snapshot does not exist or lacks the file", async () => {
    const root = await createRepo();

    expect(await readBaseFile(root, "snapshot", "src/upload.ts")).toEqual({
      ok: false,
      error: "There is no snapshot yet. Run askmiyagi snapshot first.",
    });

    await createSnapshot(root);
    await writeFile(join(root, "src", "added.ts"), "export const added = 1\n");

    const result = await readBaseFile(root, "snapshot", "src/added.ts");

    expect(result.ok).toBe(false);
  });

  it("says so when the file did not exist in the base", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "added.ts"), "export const added = 1\n");

    const result = await readBaseFile(root, "uncommitted", "src/added.ts");

    expect(result.ok).toBe(false);
  });

  it("reads from a project folder inside a larger repository", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 2\n");

    const result = await readBaseFile(join(root, "src"), "uncommitted", "upload.ts");

    expect(result.ok && result.value.source).toBe("export const limit = 1\n");
  });

  it("redacts secrets in the old version", async () => {
    const root = await createRepo();
    const key = "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890";
    await writeFile(join(root, "src", "leak.ts"), `export const key = "${key}"\n`);
    commitAll(root, "add leak");
    await writeFile(join(root, "src", "leak.ts"), "export const key = 1\n");

    const result = await readBaseFile(root, "uncommitted", "src/leak.ts");

    expect(result.ok && result.value.source).toContain("[REDACTED]");
    expect(result.ok && result.value.source).not.toContain("sk-ant-");
  });

  it("refuses files the filter hides and paths outside the project", async () => {
    const root = await createRepo();

    for (const path of [".env", "package-lock.json", "../x.ts", "/etc/passwd", "C:\\x.ts", ""]) {
      expect((await readBaseFile(root, "uncommitted", path)).ok).toBe(false);
    }
  });

  it("refuses a file that is not text", async () => {
    const root = await createRepo();
    await writeFile(join(root, "src", "data.bin"), Buffer.from([1, 0, 2, 0]));
    commitAll(root, "add binary");
    await writeFile(join(root, "src", "data.bin"), "now text\n");

    const result = await readBaseFile(root, "uncommitted", "src/data.bin");

    expect(result).toEqual({ ok: false, error: "Not a text file: src/data.bin" });
  });

  it("refuses a folder deleted since, without listing what was in it", async () => {
    const root = await createRepo();
    await rm(join(root, "src"), { recursive: true });

    const result = await readBaseFile(root, "uncommitted", "src");

    expect(result).toEqual({ ok: false, error: "Not a file: src" });
  });
});
