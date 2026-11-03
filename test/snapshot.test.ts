import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceCli, startCli, waitForExit } from "./cli-harness.ts";
import { createRepo } from "./git-helpers.ts";

describe("askmiyagi snapshot", () => {
  it("saves a snapshot of the folder and says how many files it holds", async () => {
    const root = await createRepo();
    const childProcess = startCli(sourceCli, ["snapshot", root]);

    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 0 });

    expect(childProcess.stdout.trim()).toBe("Snapshot saved: 2 files");
    expect(existsSync(join(root, ".tutor", "private", "snapshot", "src", "upload.ts"))).toBe(true);
  });

  it("reports a missing folder and exits with status 1", async () => {
    const root = await createRepo();
    const missing = join(root, "missing");
    const childProcess = startCli(sourceCli, ["snapshot", missing]);

    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });

    expect(childProcess.stderr.trim()).toBe(`Folder not found: ${missing}`);
  });
});
