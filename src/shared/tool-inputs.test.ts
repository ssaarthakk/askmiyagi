import { describe, expect, it } from "vitest";
import { parseContract } from "./parse.ts";
import { findSymbolInputSchema, grepInputSchema, readFileInputSchema } from "./tool-inputs.ts";

describe("read_file input", () => {
  it("accepts a path, a range, or a symbol", () => {
    expect(parseContract(readFileInputSchema, { path: "a.ts" }).ok).toBe(true);
    expect(parseContract(readFileInputSchema, { path: "a.ts", start: 2, end: 9 }).ok).toBe(true);
    expect(parseContract(readFileInputSchema, { path: "a.ts", symbol: "save" }).ok).toBe(true);
  });

  it("rejects a symbol combined with a range", () => {
    const result = parseContract(readFileInputSchema, { path: "a.ts", symbol: "save", start: 1 });
    expect(result).toEqual({ ok: false, error: "symbol cannot be combined with a line range" });
  });

  it("rejects an empty path and a zero line", () => {
    expect(parseContract(readFileInputSchema, { path: "" }).ok).toBe(false);
    expect(parseContract(readFileInputSchema, { path: "a.ts", start: 0 }).ok).toBe(false);
  });
});

describe("grep input", () => {
  it("accepts patterns with optional flags and globs", () => {
    const input = { patterns: ["upload", "post"], caseInsensitive: true, include: ["src/**"] };
    expect(parseContract(grepInputSchema, input).ok).toBe(true);
  });

  it("rejects empty patterns and an empty include list", () => {
    expect(parseContract(grepInputSchema, { patterns: [] }).ok).toBe(false);
    expect(parseContract(grepInputSchema, { patterns: ["a"], include: [] }).ok).toBe(false);
  });
});

describe("find_symbol input", () => {
  it("trims the name and accepts a known kind", () => {
    expect(parseContract(findSymbolInputSchema, { name: " save ", kind: "method" })).toEqual({
      ok: true,
      value: { name: "save", kind: "method" },
    });
  });

  it("rejects a blank name and an unknown kind", () => {
    expect(parseContract(findSymbolInputSchema, { name: "  " }).ok).toBe(false);
    expect(parseContract(findSymbolInputSchema, { name: "a", kind: "enum" }).ok).toBe(false);
  });
});
