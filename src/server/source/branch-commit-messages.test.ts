import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitAll, createRepo, git } from "../../../test/git-helpers.ts";
import { branchCommitMessages } from "./diff-base.ts";

describe("branchCommitMessages", () => {
  it("lists the messages of the commits on the branch, newest first, and not the default branch's own", async () => {
    const root = await createRepo();
    git(root, "switch", "-q", "-c", "feature");
    await writeFile(join(root, "src", "upload.ts"), "export const limit = 5\n");
    commitAll(root, "raise limit\n\nUploads were being cut off at one.");
    await writeFile(join(root, "src", "old.ts"), "export const old = false\n");
    commitAll(root, "flip old");

    const result = await branchCommitMessages(root);

    expect(result).toEqual({
      ok: true,
      value: ["flip old", "raise limit\n\nUploads were being cut off at one."],
    });
  });

  it("is empty on the default branch", async () => {
    const root = await createRepo();

    expect(await branchCommitMessages(root)).toEqual({ ok: true, value: [] });
  });

  it("keeps at most 50 messages", async () => {
    const root = await createRepo();
    const commits = Array.from({ length: 55 }, (_, index) =>
      [
        "commit refs/heads/feature",
        `committer Test <test@example.com> ${1_700_000_000 + index} +0000`,
        `data ${`change ${index}`.length}`,
        `change ${index}`,
        index === 0 ? "from refs/heads/main^0" : "",
      ].join("\n"),
    );
    execFileSync("git", ["fast-import", "--quiet"], { cwd: root, input: commits.join("\n") });
    git(root, "switch", "-q", "feature");

    const result = await branchCommitMessages(root);

    expect(result.ok && result.value).toHaveLength(50);
    expect(result.ok && result.value[0]).toBe("change 54");
  });

  it("cuts a very long message at 2000 characters", async () => {
    const root = await createRepo();
    git(root, "switch", "-q", "-c", "feature");
    git(root, "commit", "-q", "--allow-empty", "-m", "x".repeat(5000));

    const result = await branchCommitMessages(root);

    expect(result.ok && result.value[0]).toBe("x".repeat(2000));
  });

  it("says so when no default branch exists", async () => {
    const root = await createRepo();
    git(root, "branch", "-m", "develop");

    expect(await branchCommitMessages(root)).toEqual({
      ok: false,
      error: "No default branch found: tried origin/HEAD, main and master.",
    });
  });
});
