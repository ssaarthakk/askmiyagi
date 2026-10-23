import { realpath, stat } from "node:fs/promises";
import type { Result } from "../../shared/result.ts";

export type CodeSource = {
  root: string;
  dispose(): Promise<void>;
};

export async function openLocalFolder(path: string): Promise<Result<CodeSource>> {
  let root: string;
  try {
    root = await realpath(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return { ok: false, error: `Folder not found: ${path}` };
    }
    throw error;
  }

  if (!(await stat(root)).isDirectory()) {
    return { ok: false, error: `Not a folder: ${path}` };
  }

  return { ok: true, value: { root, dispose: async () => {} } };
}
