import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { key } from "../../../test/conversation-helpers.ts";
import { writePathProject } from "../../../test/path-project.ts";
import { clearOverlay, setOverlay } from "./overlay.ts";
import { readRedactedFile } from "./path-guard.ts";

afterEach(() => {
  clearOverlay();
});

describe("the file overlay", () => {
  it("makes reads of the overlaid file return the overlay, and no other file", async () => {
    const root = await writePathProject();
    setOverlay(root, "src/store.ts", "export const read = 0;");

    const store = await readRedactedFile(root, "src/store.ts");
    const clip = await readRedactedFile(root, "src/clip.ts");

    expect(store).toEqual({
      ok: true,
      value: { relPath: "src/store.ts", source: "export const read = 0;" },
    });
    expect(clip.ok && clip.value.source).toContain("export const clip = read;");
  });

  it("applies whichever way the path is spelled", async () => {
    const root = await writePathProject();
    setOverlay(root, "src/store.ts", "export const read = 0;");

    const read = await readRedactedFile(root, String.raw`src\store.ts`);

    expect(read.ok && read.value.source).toBe("export const read = 0;");
  });

  it("can still read the real file", async () => {
    const root = await writePathProject();
    setOverlay(root, "src/store.ts", "export const read = 0;");

    const real = await readRedactedFile(root, "src/store.ts", { withOverlay: false });

    expect(real.ok && real.value.source).toBe("export const read = 1;");
  });

  it("goes away when cleared, and never touches the disk", async () => {
    const root = await writePathProject();
    setOverlay(root, "src/store.ts", "export const read = 0;");

    clearOverlay();

    const after = await readRedactedFile(root, "src/store.ts");
    expect(after.ok && after.value.source).toBe("export const read = 1;");
    expect(await readFile(join(root, "src", "store.ts"), "utf8")).toBe("export const read = 1;");
  });

  it("does not apply to another project with the same file name", async () => {
    const root = await writePathProject();
    const other = await writePathProject();
    setOverlay(root, "src/store.ts", "export const read = 0;");

    const untouched = await readRedactedFile(other, "src/store.ts");

    expect(untouched.ok && untouched.value.source).toBe("export const read = 1;");
  });

  it("redacts secrets in the overlay", async () => {
    const root = await writePathProject();
    setOverlay(root, "src/store.ts", `export const token = "${key}";`);

    const read = await readRedactedFile(root, "src/store.ts");

    expect(read.ok && read.value.source).not.toContain("sk-ant-");
  });
});
