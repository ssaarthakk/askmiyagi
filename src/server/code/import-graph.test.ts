import { describe, expect, it } from "vitest";
import type { PathItem } from "../../shared/path.ts";
import { orderByImports } from "./import-graph.ts";
import type { ImportGraph } from "./repo-map.ts";

function graph(edges: Record<string, string[]>): ImportGraph {
  return new Map(Object.entries(edges).map(([file, imports]) => [file, new Set(imports)]));
}

function items(...files: string[]): PathItem[] {
  return files.map((file) => ({ concept: file, question: `How does ${file} work?`, file }));
}

function files(ordered: PathItem[]) {
  return ordered.map((item) => item.file);
}

describe("orderByImports", () => {
  it("puts the files that import nothing first and the files built on them after", () => {
    const imports = graph({ "app.ts": ["service.ts"], "service.ts": ["util.ts"], "util.ts": [] });

    const ordered = orderByImports(items("app.ts", "service.ts", "util.ts"), imports);

    expect(files(ordered)).toEqual(["util.ts", "service.ts", "app.ts"]);
  });

  it("counts imports through files that are not in the path", () => {
    const imports = graph({ "app.ts": ["middle.ts"], "middle.ts": ["util.ts"], "util.ts": [] });

    expect(files(orderByImports(items("app.ts", "util.ts"), imports))).toEqual([
      "util.ts",
      "app.ts",
    ]);
  });

  it("puts files that nobody imports last, even when they import nothing", () => {
    const imports = graph({
      "main.ts": [],
      "util.ts": [],
      "app.ts": ["util.ts"],
    });

    expect(files(orderByImports(items("main.ts", "util.ts"), imports))).toEqual([
      "util.ts",
      "main.ts",
    ]);
  });

  it("breaks an import cycle by path order, whatever order the files arrive in", () => {
    const imports = graph({
      "c.ts": ["b.ts"],
      "b.ts": ["a.ts"],
      "a.ts": ["b.ts"],
    });

    expect(files(orderByImports(items("c.ts", "b.ts", "a.ts"), imports))).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(files(orderByImports(items("a.ts", "c.ts", "b.ts"), imports))).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("breaks a cycle of three files by path order, whatever order the files arrive in", () => {
    const imports = graph({
      "a.ts": ["b.ts"],
      "b.ts": ["c.ts"],
      "c.ts": ["a.ts"],
      "app.ts": ["c.ts"],
    });

    for (const order of [
      ["c.ts", "b.ts", "a.ts", "app.ts"],
      ["app.ts", "a.ts", "b.ts", "c.ts"],
      ["b.ts", "app.ts", "c.ts", "a.ts"],
    ]) {
      expect(files(orderByImports(items(...order), imports))).toEqual([
        "a.ts",
        "b.ts",
        "c.ts",
        "app.ts",
      ]);
    }
  });

  it("puts a file that imports one member of a cycle after the whole cycle", () => {
    const imports = graph({
      "a.ts": ["b.ts"],
      "b.ts": ["a.ts"],
      "x.ts": ["a.ts"],
      "main.ts": ["x.ts"],
    });

    expect(files(orderByImports(items("x.ts", "b.ts", "a.ts"), imports))).toEqual([
      "a.ts",
      "b.ts",
      "x.ts",
    ]);
  });

  it("keeps the model's order for files at the same depth and for files with no imports known", () => {
    const imports = graph({ "a.ts": [], "b.ts": [], "shared.ts": ["a.ts", "b.ts"] });

    expect(files(orderByImports(items("b.ts", "README.md", "a.ts"), imports))).toEqual([
      "b.ts",
      "a.ts",
      "README.md",
    ]);
  });
});
