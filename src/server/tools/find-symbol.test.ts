import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { findSymbolTool } from "./find-symbol.ts";

const fixtureRoot = fileURLToPath(new URL("../../../test/fixtures/basic/", import.meta.url));
const temporaryRoots: string[] = [];

async function createRepo() {
  const root = await mkdtemp(join(tmpdir(), "miyagi-find-symbol-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "service.ts"),
    [
      "export function uploadClip(path: string) {}",
      "export class ClipService {",
      "  save(clip: string) {}",
      "  static create() {}",
      "}",
      "export interface ClipStore {",
      "  load(id: string): string",
      "}",
      "export type ClipId = string",
      "export const normalize = (value: string) => value.trim()",
      "const createFactory = function () {}",
      "let mutableFactory = function () {}",
      'export const status = "ready"',
    ].join("\n"),
  );
  await writeFile(join(root, "src", "other.ts"), "export function uploadClip() {}\n");
  await writeFile(
    join(root, "src", "destructured.ts"),
    "export const { primaryClip, sourceClip: aliasedClip } = clips\nexport const [firstClip, secondClip] = clips\n",
  );
  await writeFile(join(root, "src", ".env"), "export function hiddenSecret() {}\n");
  await writeFile(
    join(root, "src", "nested.ts"),
    "if (true) { function hiddenBlock() {} }\nexport namespace Hidden { export function hiddenNamespace() {} }\n",
  );
  await writeFile(join(root, "notes.md"), "function notCode() {}\n");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("findSymbolTool", () => {
  it("finds top-level declarations and class or interface members in sorted files", async () => {
    const root = await createRepo();

    const result = await findSymbolTool(root, { name: "uploadClip" });

    expect(result).toEqual({
      isError: false,
      text: "function uploadClip src/other.ts:1-1\nfunction uploadClip src/service.ts:1-1",
    });

    const save = await findSymbolTool(root, { name: "save" });
    expect(save.text).toBe("method ClipService.save src/service.ts:3-3");

    const load = await findSymbolTool(root, { name: "ClipStore.load" });
    expect(load.text).toBe("method ClipStore.load src/service.ts:7-7");
  });

  it("classifies declarations and function-valued consts, and filters by kind", async () => {
    const root = await createRepo();

    const functions = await findSymbolTool(root, { name: "normalize", kind: "function" });
    const functionExpression = await findSymbolTool(root, {
      name: "createFactory",
      kind: "function",
    });
    const variables = await findSymbolTool(root, { name: "status", kind: "variable" });
    const mutableVariable = await findSymbolTool(root, {
      name: "mutableFactory",
      kind: "variable",
    });
    const types = await findSymbolTool(root, { name: "ClipId", kind: "type" });
    const classes = await findSymbolTool(root, { name: "ClipService", kind: "class" });
    const interfaces = await findSymbolTool(root, { name: "ClipStore", kind: "interface" });
    const methods = await findSymbolTool(root, { name: "load", kind: "method" });

    expect(functions.text).toBe("function normalize src/service.ts:10-10");
    expect(functionExpression.text).toBe("function createFactory src/service.ts:11-11");
    expect(mutableVariable.text).toBe("variable mutableFactory src/service.ts:12-12");
    expect(variables.text).toBe("variable status src/service.ts:13-13");
    expect(types.text).toBe("type ClipId src/service.ts:9-9");
    expect(classes.text).toBe("class ClipService src/service.ts:2-5");
    expect(interfaces.text).toBe("interface ClipStore src/service.ts:6-8");
    expect(methods.text).toBe("method ClipStore.load src/service.ts:7-7");
  });

  it("finds individual bindings from object and array destructuring", async () => {
    const root = await createRepo();

    for (const [name, line] of [
      ["primaryClip", 1],
      ["aliasedClip", 1],
      ["firstClip", 2],
      ["secondClip", 2],
    ] as const) {
      await expect(findSymbolTool(root, { name, kind: "variable" })).resolves.toMatchObject({
        isError: false,
        text: `variable ${name} src/destructured.ts:${line}-${line}`,
      });
    }
  });

  it("returns an empty result with a hint when no definition matches", async () => {
    const root = await createRepo();

    await expect(findSymbolTool(root, { name: "missing" })).resolves.toEqual({
      isError: false,
      text: "No symbols found for 'missing'. Try a broader name.",
    });
    await expect(findSymbolTool(root, { name: "notCode" })).resolves.toMatchObject({
      isError: false,
      text: "No symbols found for 'notCode'. Try a broader name.",
    });
  });

  it("does not report definitions from filtered files", async () => {
    const root = await createRepo();

    await expect(findSymbolTool(root, { name: "hiddenSecret" })).resolves.toMatchObject({
      isError: false,
      text: "No symbols found for 'hiddenSecret'. Try a broader name.",
    });
  });

  it("does not report declarations nested inside blocks or namespaces", async () => {
    const root = await createRepo();

    for (const name of ["hiddenBlock", "hiddenNamespace"]) {
      await expect(findSymbolTool(root, { name })).resolves.toMatchObject({
        isError: false,
        text: `No symbols found for '${name}'. Try a broader name.`,
      });
    }
  });

  it("finds abstract classes, generators, ambient functions and JavaScript fields", async () => {
    const root = await createRepo();
    await writeFile(
      join(root, "src", "extra.ts"),
      [
        "export abstract class Shape {",
        "  abstract area(): number;",
        "}",
        "export function* generateIds() {}",
        "export const nextId = function* () {}",
        "declare function ambientLoad(path: string): void;",
        "export function overloaded(value: string): string;",
        "export function overloaded(value: unknown) { return value; }",
      ].join("\n"),
    );
    await writeFile(join(root, "src", "player.js"), "class Player {\n  volume = 1;\n}\n");

    const expected: Record<string, string> = {
      Shape: "class Shape src/extra.ts:1-3",
      "Shape.area": "method Shape.area src/extra.ts:2-2",
      generateIds: "function generateIds src/extra.ts:4-4",
      nextId: "function nextId src/extra.ts:5-5",
      ambientLoad: "function ambientLoad src/extra.ts:6-6",
      overloaded: "function overloaded src/extra.ts:8-8",
      "Player.volume": "variable Player.volume src/player.js:2-2",
    };
    for (const [name, text] of Object.entries(expected)) {
      await expect(findSymbolTool(root, { name })).resolves.toEqual({ isError: false, text });
    }
  });

  it("treats declarations in declaration files as ambient", async () => {
    const root = await createRepo();
    await writeFile(
      join(root, "src", "types.d.ts"),
      "export function typed(): void;\ndeclare class Remote {\n  fetch(): string;\n}\n",
    );

    await expect(findSymbolTool(root, { name: "typed" })).resolves.toMatchObject({
      text: "function typed src/types.d.ts:1-1",
    });
    await expect(findSymbolTool(root, { name: "Remote.fetch" })).resolves.toMatchObject({
      text: "method Remote.fetch src/types.d.ts:3-3",
    });
  });

  it("caps results at 50 definitions", async () => {
    const root = await createRepo();
    await writeFile(
      join(root, "src", "many.ts"),
      Array.from({ length: 55 }, (_, index) => `class C${index} { run() {} }`).join("\n"),
    );

    const result = await findSymbolTool(root, { name: "run" });

    expect(result.text.split("\n")).toHaveLength(51);
    expect(result.text).toContain("50 of 55");
  });

  it("finds definitions in the basic fixture but not in generated files", async () => {
    await expect(findSymbolTool(fixtureRoot, { name: "ClipService.save" })).resolves.toEqual({
      isError: false,
      text: "method ClipService.save src/clip-service.ts:2-4",
    });
    await expect(findSymbolTool(fixtureRoot, { name: "generated" })).resolves.toMatchObject({
      text: "No symbols found for 'generated'. Try a broader name.",
    });
  });

  it("rejects invalid input", async () => {
    const root = await createRepo();

    await expect(findSymbolTool(root, { name: "save", kind: "property" })).resolves.toMatchObject({
      isError: true,
    });
  });
});
