import { describe, expect, it } from "vitest";
import { parseFile } from "./parse-cache.ts";

describe("parse cache", () => {
  it.each(["sample.ts", "sample.mts", "sample.cts"])(
    "parses %s with the TypeScript grammar",
    async (path) => {
      const tree = await parseFile(path, 'const value: string = "ok";');

      expect(tree?.rootNode.hasError).toBe(false);
      expect(tree?.language.types).toContain("interface_declaration");
      expect(tree?.language.types).not.toContain("jsx_element");
    },
  );

  it("uses the TSX grammar for TSX files", async () => {
    const tree = await parseFile("sample.tsx", "const view: JSX.Element = <div />;");

    expect(tree?.rootNode.hasError).toBe(false);
    expect(tree?.language.types).toContain("interface_declaration");
    expect(tree?.language.types).toContain("jsx_element");
  });

  it.each(["sample.js", "sample.mjs", "sample.cjs", "sample.jsx"])(
    "parses %s with the JavaScript grammar",
    async (path) => {
      const tree = await parseFile(path, 'const value = "ok";');

      expect(tree?.rootNode.hasError).toBe(false);
      expect(tree?.language.types).toContain("jsx_element");
      expect(tree?.language.types).not.toContain("interface_declaration");
    },
  );

  it("returns null when a file has no parser", async () => {
    await expect(parseFile("README.md", "# Notes")).resolves.toBeNull();
  });

  it("reuses a tree for matching content and grammar", async () => {
    const source = "export const value = 1;";
    const [first, second] = await Promise.all([
      parseFile("first.ts", source),
      parseFile("second.ts", source),
    ]);
    const third = await parseFile("third.ts", source);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("parses changed content again", async () => {
    const first = await parseFile("sample.ts", "export const value = 1;");
    const second = await parseFile("sample.ts", "export const value = 2;");

    expect(second).not.toBe(first);
    expect(second?.rootNode.text).toBe("export const value = 2;");
  });

  it("keeps identical content separate when the grammar differs", async () => {
    const source = 'const value: string = "ok";';
    const typescriptTree = await parseFile("sample.ts", source);
    const javascriptTree = await parseFile("sample.js", source);

    expect(typescriptTree).not.toBe(javascriptTree);
    expect(typescriptTree?.rootNode.hasError).toBe(false);
    expect(javascriptTree?.rootNode.hasError).toBe(true);
  });
});
