import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usage } from "../../../test/ask-helpers.ts";
import { resultOf } from "../../../test/eval-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { readResult, writeResult } from "./runner.ts";

const result = resultOf([
  { question: "Q?", runs: [{ checks: { validJson: true }, usage, durationMs: 1 }] },
]);

describe("writeResult and readResult", () => {
  it("names the file after the start time, with colons replaced", async () => {
    const folder = await tempDir();
    const path = await writeResult(folder, result);
    const names = await readdir(folder);
    expect(names).toEqual([`${result.startedAt.replaceAll(":", "-")}.json`]);
    expect(names[0]).not.toContain(":");
    expect(path).toBe(join(folder, names[0] ?? ""));
  });

  it("reads back what was written", async () => {
    const folder = await tempDir();
    const read = await readResult(await writeResult(folder, result));
    expect(read).toEqual({ ok: true, value: result });
  });

  it("explains a result file that is missing, not JSON or the wrong shape", async () => {
    const folder = await tempDir();
    const missing = await readResult(join(folder, "missing.json"));
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("missing.json") });

    await writeFile(join(folder, "bad.json"), "{");
    expect(await readResult(join(folder, "bad.json"))).toMatchObject({
      ok: false,
      error: expect.stringContaining("not valid JSON"),
    });

    await writeFile(join(folder, "wrong.json"), "{}");
    expect(await readResult(join(folder, "wrong.json"))).toMatchObject({
      ok: false,
      error: expect.stringContaining("suite"),
    });
  });
});
