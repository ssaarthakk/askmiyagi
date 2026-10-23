import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalFolder } from "./local-folder.ts";

const folders: string[] = [];

async function createFolder() {
  const folder = await mkdtemp(join(tmpdir(), "miyagi-local-folder-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("openLocalFolder", () => {
  it("resolves a folder link to its real root and provides a no-op disposer", async ({ skip }) => {
    const folder = await createFolder();
    const target = join(folder, "project");
    const link = join(folder, "project-link");
    await mkdir(target);
    try {
      await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        skip();
        return;
      }
      throw error;
    }

    const result = await openLocalFolder(link);

    expect(result).toEqual({
      ok: true,
      value: { root: await realpath(target), dispose: expect.any(Function) },
    });
    if (!result.ok) throw new Error(result.error);
    await expect(result.value.dispose()).resolves.toBeUndefined();
  });

  it("reports a missing folder", async () => {
    const missing = join(await createFolder(), "missing");

    await expect(openLocalFolder(missing)).resolves.toEqual({
      ok: false,
      error: `Folder not found: ${missing}`,
    });
  });

  it("reports a file instead of a folder", async () => {
    const folder = await createFolder();
    const file = join(folder, "file.ts");
    await writeFile(file, "export const value = 1;\n");

    await expect(openLocalFolder(file)).resolves.toEqual({
      ok: false,
      error: `Not a folder: ${file}`,
    });
  });
});
