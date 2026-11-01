import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/temp-dir.ts";
import type { Anchor } from "../shared/anchor.ts";
import type { WatchEvent } from "../shared/events.ts";
import { createTourWatch } from "./tour-watch.ts";

const file = "src/clip-service.ts";
const saveAnchor: Anchor = { file, symbol: "ClipService.save" };
const saveRange = { file, start: 2, end: 4, capped: false };

async function startedTour(ranges = [saveRange as typeof saveRange | null]) {
  const root = await tempDir();
  await cp("test/fixtures/basic", root, { recursive: true });
  const events: WatchEvent[] = [];
  const watch = createTourWatch({ root, publish: (event) => events.push(event) });
  watch.start();
  watch.addStep([saveAnchor], ranges);
  return { root, events, watch };
}

describe("createTourWatch", () => {
  it("sends the re-resolved ranges when a file with an anchor changes", async () => {
    const { root, events, watch } = await startedTour();
    const source = await readFile(join(root, file), "utf8");
    await writeFile(join(root, file), `export const header = 1;\n${source}`);

    await watch.changed([file]);

    expect(events).toEqual([
      { type: "ranges", ranges: [[{ file, start: 3, end: 5, capped: false }]] },
    ]);
  });

  it("sends stale after the ranges when an anchor can no longer be found", async () => {
    const { root, events, watch } = await startedTour();
    await writeFile(join(root, file), "export const other = 1;\n");

    await watch.changed([file]);

    expect(events).toEqual([
      { type: "ranges", ranges: [[null]] },
      { type: "stale", file },
    ]);
  });

  it("does not send stale for an anchor that was never found", async () => {
    const { root, events, watch } = await startedTour([null]);
    await writeFile(join(root, file), "export const other = 1;\n");

    await watch.changed([file]);

    expect(events).toEqual([{ type: "ranges", ranges: [[null]] }]);
  });

  it("leaves a step that streams in during re-resolving alone", async () => {
    const { root, events, watch } = await startedTour();
    const source = await readFile(join(root, file), "utf8");
    await writeFile(join(root, file), `export const header = 1;\n${source}`);
    const uploadRange = { file: "src/upload.ts", start: 1, end: 3, capped: false };

    const changing = watch.changed([file]);
    watch.addStep([{ file: "src/upload.ts", symbol: "uploadClip" }], [uploadRange]);
    await changing;

    expect(events).toEqual([
      { type: "ranges", ranges: [[{ file, start: 3, end: 5, capped: false }]] },
    ]);
  });

  it("ignores a change to a file with no anchor", async () => {
    const { events, watch } = await startedTour();

    await watch.changed(["src/upload.ts"]);

    expect(events).toEqual([]);
  });

  it("forgets the old tour when a new ask starts", async () => {
    const { root, events, watch } = await startedTour();
    watch.start();
    await writeFile(join(root, file), "export const other = 1;\n");

    await watch.changed([file]);

    expect(events).toEqual([]);
  });

  it("sends only the newest result when changes overlap", async () => {
    const { root, events, watch } = await startedTour();
    await writeFile(join(root, file), "export const other = 1;\n");

    await Promise.all([watch.changed([file]), watch.changed([file])]);

    expect(events.filter((event) => event.type === "ranges")).toHaveLength(1);
  });
});
