import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { watchFolder } from "./watcher.ts";

const open: { close(): void }[] = [];

function watch(root: string, onChange: (paths: string[]) => void) {
  const watcher = watchFolder(root, onChange);
  open.push(watcher);
  return watcher;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const watcher of open.splice(0)) watcher.close();
});

describe("watchFolder", () => {
  it("reports a burst of writes once, with slash-separated paths", async () => {
    const root = await tempDir();
    await mkdir(join(root, "src"));
    const changes: string[][] = [];
    watch(root, (paths) => changes.push(paths));

    await writeFile(join(root, "src", "a.ts"), "1");
    await writeFile(join(root, "src", "a.ts"), "2");
    await writeFile(join(root, "src", "b.ts"), "3");

    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0));
    await pause(200);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
    expect(changes[0]?.some((path) => path.includes("\\"))).toBe(false);
  });

  it("reports nothing after it is closed", async () => {
    const root = await tempDir();
    const changes: string[][] = [];
    const watcher = watch(root, (paths) => changes.push(paths));

    watcher.close();
    await writeFile(join(root, "late.ts"), "1");
    await pause(250);

    expect(changes).toEqual([]);
  });
});
