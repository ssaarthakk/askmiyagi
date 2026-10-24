import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readFileTool } from "./read-file.ts";

const fixtureRoot = fileURLToPath(new URL("../../../test/fixtures/basic/", import.meta.url));
const roots: string[] = [];
const outsideFiles: string[] = [];

async function createRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-read-file-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(root, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(outsideFiles.splice(0).map((path) => rm(path, { force: true })));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("read_file tool", () => {
  it("numbers requested lines and redacts secrets", async () => {
    const root = await createRepo({
      "src/config.ts":
        'const apiKey = "0123456789abcdefghijKLMNOPQRSTUVWXYZ";\nexport const ready = true;\n',
    });

    const result = await readFileTool(root, { path: "src/config.ts", start: 1, end: 2 });

    expect(result).toEqual({
      isError: false,
      text: '1: const apiKey = "[REDACTED]";\n2: export const ready = true;',
    });
  });

  it("redacts private key blocks without changing line numbers", async () => {
    const root = await createRepo({
      "notes.md": [
        ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
        "private material",
        ["-----END ", "PRIVATE KEY-----"].join(""),
      ].join("\n"),
    });

    const result = await readFileTool(root, { path: "notes.md" });

    expect(result).toEqual({
      isError: false,
      text: "1: [REDACTED]\n2: [REDACTED]\n3: [REDACTED]",
    });
  });

  it("returns a parsed declaration block for a symbol", async () => {
    const root = await createRepo({
      "src/service.ts": [
        "const ignored = 1;",
        "export class ClipService {",
        "  save(clip: string): string {",
        "    return clip;",
        "  }",
        "}",
        "export function uploadClip(path: string): string {",
        "  return path;",
        "}",
      ].join("\n"),
    });

    const result = await readFileTool(root, { path: "src/service.ts", symbol: "ClipService.save" });

    expect(result).toEqual({
      isError: false,
      text: ["3:   save(clip: string): string {", "4:     return clip;", "5:   }"].join("\n"),
    });
  });

  it("returns an outline for large parsed files without a range", async () => {
    const lines = Array.from({ length: 405 }, (_, index) => `const value${index} = ${index};`);
    lines.push("export function lastEntry(value: string): string { return value; }");
    lines.push("export const loadEntry = (path: string): string => { return path; };");
    const root = await createRepo({ "src/large.ts": lines.join("\n") });

    const result = await readFileTool(root, { path: "src/large.ts" });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("406-406: export function lastEntry(value: string): string");
    expect(result.text).toContain("407-407: export const loadEntry = (path: string): string =>");
    expect(result.text).not.toContain("return path");
    expect(result.text).not.toContain("const value0");
  });

  it("caps an unparsed large file at 250 numbered lines", async () => {
    const root = await createRepo({
      "notes.md": Array.from({ length: 405 }, (_, index) => `line ${index + 1}`).join("\n"),
    });

    const result = await readFileTool(root, { path: "notes.md" });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("250: line 250");
    expect(result.text).toContain("showing 1–250 of 405");
    expect(result.text).not.toContain("251: line 251");
  });

  it("caps ordinary output at 250 numbered lines", async () => {
    const root = await createRepo({
      "notes.md": Array.from({ length: 260 }, (_, index) => `line ${index + 1}`).join("\n"),
    });

    const result = await readFileTool(root, { path: "notes.md", start: 5, end: 260 });

    expect(result.isError).toBe(false);
    expect(result.text).toContain("254: line 254");
    expect(result.text).toContain("showing 5–254 of 260");
    expect(result.text).not.toContain("255: line 255");
  });

  it("returns the block of a variable symbol that find_symbol reports", async () => {
    const root = await createRepo({
      "src/limits.ts": "export function first() {}\nexport const LIMIT = 5;\n",
    });

    await expect(readFileTool(root, { path: "src/limits.ts", symbol: "LIMIT" })).resolves.toEqual({
      isError: false,
      text: "2: export const LIMIT = 5;",
    });
  });

  it("returns an empty result for an empty file", async () => {
    const root = await createRepo({ "src/empty.ts": "" });

    await expect(readFileTool(root, { path: "src/empty.ts" })).resolves.toEqual({
      isError: false,
      text: "(empty file)",
    });
  });

  it("redacts private keys inside outline signatures", async () => {
    const lines = Array.from({ length: 405 }, (_, index) => `const value${index} = ${index};`);
    lines.push(
      "export function load(key = `",
      ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
      "private material",
      ["-----END ", "PRIVATE KEY-----"].join(""),
      "`) {}",
    );
    const root = await createRepo({ "src/large.ts": lines.join("\n") });

    const result = await readFileTool(root, { path: "src/large.ts" });

    expect(result.text).toContain("406-410: export function load(key = `");
    expect(result.text).not.toContain("private material");
  });

  it("shows the first 250 lines of a large parsed file without declarations", async () => {
    const lines = Array.from({ length: 405 }, (_, index) => `it("case ${index + 1}", () => {});`);
    const root = await createRepo({ "src/large.test.ts": lines.join("\n") });

    const result = await readFileTool(root, { path: "src/large.test.ts" });

    expect(result.text).toContain('250: it("case 250", () => {});');
    expect(result.text).toContain("showing 1–250 of 405");
  });

  it("lists line ranges for ambiguous symbols", async () => {
    const root = await createRepo({
      "src/box.ts": [
        "export class Box {",
        "  get value() { return 1; }",
        "  set value(next: number) {}",
        "}",
      ].join("\n"),
    });

    await expect(readFileTool(root, { path: "src/box.ts", symbol: "value" })).resolves.toEqual({
      isError: true,
      text: "Symbol is ambiguous: value. Candidates: Box.value 2-2, Box.value 3-3",
    });
  });

  it("reads a file from the basic fixture", async () => {
    await expect(readFileTool(fixtureRoot, { path: "src/upload.ts" })).resolves.toEqual({
      isError: false,
      text: "1: export async function uploadClip(path: string) {\n2:   return path;\n3: }",
    });
    await expect(readFileTool(fixtureRoot, { path: "src/generated.ts" })).resolves.toMatchObject({
      isError: true,
    });
  });

  it("returns readable errors for inaccessible paths, bad ranges, and missing symbols", async () => {
    const root = await createRepo({
      "src/visible.ts": "export const visible = true;",
      "src/.env": "hidden",
    });

    await expect(readFileTool(root, { path: "missing.ts" })).resolves.toMatchObject({
      isError: true,
    });
    await expect(readFileTool(root, { path: "src/.env" })).resolves.toMatchObject({
      isError: true,
    });
    const outsidePath = `${root}-outside.ts`;
    outsideFiles.push(outsidePath);
    await writeFile(outsidePath, "export const outside = true;");
    await expect(
      readFileTool(root, { path: `../${basename(outsidePath)}` }),
    ).resolves.toMatchObject({
      isError: true,
      text: "Path escapes project root",
    });
    await expect(
      readFileTool(root, { path: "src/visible.ts", start: 0, end: 1 }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      readFileTool(root, { path: "src/visible.ts", start: 2, end: 2 }),
    ).resolves.toMatchObject({ isError: true, text: "Invalid line range: 2-2 for 1 lines" });
    await expect(
      readFileTool(root, { path: "src/visible.ts", start: 3, end: 4 }),
    ).resolves.toMatchObject({ isError: true, text: "Invalid line range: 3-4 for 1 lines" });
    await expect(
      readFileTool(root, { path: "src/visible.ts", start: 1, end: 9999 }),
    ).resolves.toEqual({ isError: false, text: "1: export const visible = true;" });
    await expect(
      readFileTool(root, { path: "src/visible.ts", symbol: "missing" }),
    ).resolves.toMatchObject({ isError: true });
  });
});
