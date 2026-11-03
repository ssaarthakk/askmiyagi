import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runTool } from "./run-tool.ts";

describe("runTool", () => {
  it.each([
    ["backslashes", "C:\\work\\repo"],
    ["forward slashes", "C:/work/repo"],
  ])("replaces the project root written with %s in an error", async (_name, written) => {
    const root = "C:\\work\\repo";

    const result = await runTool(root, "demo", z.object({}), {}, () => {
      throw new Error(`fatal: dubious ownership at '${written}/src'`);
    });

    expect(result).toEqual({ isError: true, text: "fatal: dubious ownership at './src'" });
  });
});
