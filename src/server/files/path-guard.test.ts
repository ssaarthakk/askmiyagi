import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { guardPath } from "./path-guard.ts";

const temporaryRoots: string[] = [];

async function makeProject() {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-path-guard-"));
  const root = join(parent, "project");
  temporaryRoots.push(parent);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "notes.md"), "notes\n");
  await writeFile(join(root, "src", "upload.ts"), "export function upload() {}\n");
  await writeFile(join(root, ".env.local"), "private\n");
  return { parent, root };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("guardPath", () => {
  it("resolves visible root-relative paths and normalizes backslashes", async () => {
    const { root } = await makeProject();

    await expect(guardPath(root, "src\\upload.ts")).resolves.toEqual({
      ok: true,
      value: { realPath: join(await realpath(root), "src", "upload.ts"), relPath: "src/upload.ts" },
    });
  });

  it("rejects absolute paths in POSIX, Windows and UNC forms", async () => {
    const { root } = await makeProject();
    const paths = [
      "/etc/passwd",
      "\\Windows\\win.ini",
      "C:\\secret.txt",
      "C:secret.txt",
      "\\\\server\\share\\file",
    ];

    for (const path of paths) {
      const result = await guardPath(root, path);
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.error).not.toMatch(/[\r\n]/);
    }
  });

  it("rejects traversal that escapes the project but resolves in-root dot segments", async () => {
    const { parent, root } = await makeProject();
    await writeFile(join(parent, "outside.txt"), "outside\n");

    const outside = await guardPath(root, "../outside.txt");
    expect(outside).toEqual({ ok: false, error: "Path escapes project root" });
    await expect(guardPath(root, "src/../notes.md")).resolves.toEqual({
      ok: true,
      value: { realPath: join(await realpath(root), "notes.md"), relPath: "notes.md" },
    });
  });

  it("rejects missing and filtered paths as error values", async () => {
    const { root } = await makeProject();

    for (const path of ["missing.ts", ".env.local"]) {
      const result = await guardPath(root, path);
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.error).not.toMatch(/[\r\n]/);
    }
  });

  it("returns a one-line error when the shared file filter cannot check a path", async () => {
    const { root } = await makeProject();
    await writeFile(join(root, ".gitignore"), Buffer.alloc(1024 * 1024 + 1, 42));

    await expect(guardPath(root, "notes.md")).resolves.toEqual({
      ok: false,
      error: "Project config exceeds 1 MB: .gitignore",
    });
  });

  it("rejects links whose resolved target is outside the project", async ({ skip }) => {
    const { parent, root } = await makeProject();
    const outside = join(parent, "outside.ts");
    await writeFile(outside, "export const secret = true;\n");
    try {
      await symlink(outside, join(root, "external.ts"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }

    await expect(guardPath(root, "external.ts")).resolves.toEqual({
      ok: false,
      error: "Path escapes project root",
    });
  });
});
