import { describe, expect, it } from "vitest";
import { applyDrill } from "./drill.ts";

const source = "const a = 1;\nconst b = 2;\nconst c = 3;\n";

describe("applyDrill", () => {
  it("applies several edits, each found exactly once in the real file", () => {
    const result = applyDrill(source, [
      { find: "const c = 3;", replace: "const c = 30;" },
      { find: "const a = 1;", replace: "const a = 10;" },
    ]);

    expect(result).toEqual({ ok: true, value: "const a = 10;\nconst b = 2;\nconst c = 30;\n" });
  });

  it("inserts the replacement as plain text, whatever characters it holds", () => {
    const result = applyDrill(source, [{ find: "const b = 2;", replace: "const b = '$&$1$$';" }]);

    expect(result).toEqual({
      ok: true,
      value: "const a = 1;\nconst b = '$&$1$$';\nconst c = 3;\n",
    });
  });

  it("refuses a find that is not in the file", () => {
    const result = applyDrill(source, [{ find: "const z = 9;", replace: "const z = 0;" }]);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/not found/i) });
  });

  it("refuses a find that occurs more than once", () => {
    const result = applyDrill(source, [{ find: "const", replace: "let" }]);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/more than once/i) });
  });

  it("refuses edits that overlap", () => {
    const result = applyDrill(source, [
      { find: "const a = 1;\nconst b", replace: "x" },
      { find: "b = 2;", replace: "y" },
    ]);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/overlap/i) });
  });

  it("refuses edits that change nothing", () => {
    const result = applyDrill(source, [{ find: "const a = 1;", replace: "const a = 1;" }]);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/change nothing/i) });
  });
});
