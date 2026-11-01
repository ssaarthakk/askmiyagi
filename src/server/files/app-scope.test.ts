import { cp, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { isVisible, listVisibleFiles, scopeToApp } from "./file-filter.ts";
import { guardPath } from "./path-guard.ts";

const fixture = resolve(import.meta.dirname, "../../../test/fixtures/monorepo");

async function project() {
  const parent = await tempDir();
  await cp(fixture, join(parent, "project"), { recursive: true });
  return realpath(join(parent, "project"));
}

async function scopedProject(app: string) {
  const root = await project();
  scopeToApp(root, app);
  return root;
}

describe("app scope", () => {
  it("lists only the app folder and the root config files", async () => {
    const root = await scopedProject("apps/web");

    await expect(listVisibleFiles(root)).resolves.toEqual([
      "apps/web/package.json",
      "apps/web/src/page.ts",
      "tsconfig.json",
    ]);
  });

  it("hides files of other apps, including their config files, and other root files", async () => {
    const root = await scopedProject("apps/web");

    await expect(isVisible(root, "apps/web/src/page.ts")).resolves.toBe(true);
    await expect(isVisible(root, "tsconfig.json")).resolves.toBe(true);
    for (const path of [
      "apps/api/src/server.ts",
      "apps/api/tsconfig.json",
      "README.md",
      "package.json",
    ]) {
      await expect(isVisible(root, path)).resolves.toBe(false);
    }
  });

  it("matches config names exactly, so a root composer.json stays hidden", async () => {
    const root = await scopedProject("apps/web");
    await writeFile(join(root, "composer.json"), "{}\n");
    await writeFile(join(root, "tsconfigXjson"), "{}\n");

    await expect(isVisible(root, "composer.json")).resolves.toBe(false);
    await expect(isVisible(root, "tsconfigXjson")).resolves.toBe(false);
  });

  it("makes the path guard refuse a file outside the app", async () => {
    const root = await scopedProject("apps/web");

    await expect(guardPath(root, "apps/api/src/server.ts")).resolves.toEqual({
      ok: false,
      error: "Path is not a visible file",
    });
    await expect(guardPath(root, "apps/web/src/page.ts")).resolves.toMatchObject({ ok: true });
  });

  it("keeps whole-repo visibility for a root that has no app", async () => {
    const root = await project();

    await expect(isVisible(root, "apps/api/src/server.ts")).resolves.toBe(true);
  });
});
