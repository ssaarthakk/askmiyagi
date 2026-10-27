import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Anchor } from "../../shared/anchor.ts";
import { resolveAnchor } from "./anchor-resolver.ts";

const fixtureRoot = fileURLToPath(new URL("../../../test/fixtures/basic/", import.meta.url));
const temporaryRoots: string[] = [];

const serviceLines = [
  "export function uploadClip(path: string) {",
  "  if (path) {",
  "    return path;",
  "  }",
  "  return publish(",
  "    path,",
  "    true,",
  "  );",
  "}",
  "export class First {",
  "  run() {}",
  "}",
  "export class Second {",
  "  run() {}",
  "}",
  "function twin() {",
  "  return value;",
  "}",
  "function twin2() {",
  "  return value;",
  "}",
];

async function createRepo(files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-anchor-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "service.ts"), serviceLines.join("\n"));
  await writeFile(join(root, "notes.md"), "# Notes\n\nFirst point\nSecond point\n");
  await writeFile(join(root, ".env"), "TOKEN=1\n");
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(root, path), content);
  }
  return root;
}

function longFunction(bodyLines: number) {
  return [
    "export function long() {",
    ...Array.from({ length: bodyLines }, (_, index) => `  step${index}();`),
    "}",
  ].join("\n");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resolveAnchor with a symbol", () => {
  it("resolves to the definition's block", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", symbol: "uploadClip" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/service.ts", start: 1, end: 9, capped: false },
    });
    await expect(
      resolveAnchor(root, { file: "src/service.ts", symbol: "Second.run" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/service.ts", start: 14, end: 14, capped: false },
    });
  });

  it("highlights the first definition of an unqualified name with several definitions", async () => {
    const root = await createRepo();

    const result = await resolveAnchor(root, { file: "src/service.ts", symbol: "run" });

    expect(result).toMatchObject({ ok: true, value: { file: "src/service.ts", start: 11 } });
  });

  it("rejects a missing symbol", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", symbol: "nothing" }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining("nothing") });
  });

  it("rejects a symbol that is not mentioned in a file without a parser", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "notes.md", symbol: "NotMentionedAnywhere" }),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("notes.md"),
    });
  });

  it("cuts blocks over 40 lines to 40 and flags them as capped", async () => {
    const root = await createRepo({
      "src/exact.ts": longFunction(38),
      "src/long.ts": longFunction(60),
    });

    await expect(resolveAnchor(root, { file: "src/exact.ts", symbol: "long" })).resolves.toEqual({
      ok: true,
      value: { file: "src/exact.ts", start: 1, end: 40, capped: false },
    });
    await expect(resolveAnchor(root, { file: "src/long.ts", symbol: "long" })).resolves.toEqual({
      ok: true,
      value: { file: "src/long.ts", start: 1, end: 40, capped: true },
    });
  });
});

describe("resolveAnchor with a line and text", () => {
  it("expands to the smallest enclosing statement", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 3, text: "return path;" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/service.ts", start: 3, end: 3, capped: false },
    });
    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 2, text: "if (path) {" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/service.ts", start: 2, end: 4, capped: false },
    });
  });

  it("expands a line inside a multi-line statement to the whole statement", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 6, text: "path," }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/service.ts", start: 5, end: 8, capped: false },
    });
  });

  it("matches the trimmed text and picks the nearest matching line", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 18, text: "   return value;  " }),
    ).resolves.toMatchObject({ ok: true, value: { start: 17 } });
    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 19, text: "return value;" }),
    ).resolves.toMatchObject({ ok: true, value: { start: 20 } });
  });

  it("rejects text that matches no line, or only whitespace", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 3, text: "return other;" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      resolveAnchor(root, { file: "src/service.ts", line: 3, text: "   " }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("returns the single verified line in a file without a parser", async () => {
    const root = await createRepo();

    await expect(
      resolveAnchor(root, { file: "notes.md", line: 1, text: "Second point" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "notes.md", start: 4, end: 4, capped: false },
    });
  });

  it("matches loosely quoted lines and finds a declaration in a file without a parser", async () => {
    const root = await createRepo({ "tool.py": "from a import run\nrun()\ndef run(name):\n" });
    const resolve = (anchor: Anchor) =>
      resolveAnchor(root, anchor).then((found) => found.ok && found.value.start);
    await expect(resolve({ file: "notes.md", line: 1, text: "Second    point" })).resolves.toBe(4);
    await expect(
      resolve({ file: "src/service.ts", line: 9, text: "uploadClip(path: string)" }),
    ).resolves.toBe(1);
    await expect(resolve({ file: "tool.py", symbol: "run" })).resolves.toBe(3);
  });

  it("finds statements in files with CRLF line endings", async () => {
    const root = await createRepo({
      "src/windows.ts": serviceLines.join("\r\n"),
    });

    await expect(
      resolveAnchor(root, { file: "src/windows.ts", line: 6, text: "path," }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/windows.ts", start: 5, end: 8, capped: false },
    });
  });

  it("keeps the earlier line when two matches are equally near", async () => {
    const root = await createRepo({ "src/calls.ts": "run();\nstop();\nrun();\n" });

    await expect(
      resolveAnchor(root, { file: "src/calls.ts", line: 2, text: "run();" }),
    ).resolves.toMatchObject({ ok: true, value: { start: 1 } });
  });

  it("spans the whole line when it contains non-ASCII text", async () => {
    const root = await createRepo({
      "src/unicode.ts": 'function set() {\n  a = "🎉🎉🎉🎉🎉🎉"; b = 1;\n}\n',
    });

    await expect(
      resolveAnchor(root, { file: "src/unicode.ts", line: 2, text: 'a = "🎉🎉🎉🎉🎉🎉"; b = 1;' }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/unicode.ts", start: 1, end: 3, capped: false },
    });
  });

  it("keeps the anchored line inside a capped block", async () => {
    const root = await createRepo({
      "src/config.ts": [
        "export const config = {",
        ...Array.from({ length: 60 }, (_, index) => `  key${index}: ${index},`),
        "};",
      ].join("\n"),
      "src/long.ts": longFunction(60),
    });

    await expect(
      resolveAnchor(root, { file: "src/config.ts", line: 50, text: "key48: 48," }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/config.ts", start: 11, end: 50, capped: true },
    });
    await expect(
      resolveAnchor(root, { file: "src/long.ts", line: 1, text: "export function long() {" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/long.ts", start: 1, end: 40, capped: true },
    });
  });

  it("does not match text that redaction removed from the file", async () => {
    const secret = "sk-ant-abcdefghijklmnopqrstuvwxyz1234567890";
    const root = await createRepo({ "src/keys.ts": `export const apiKey = "${secret}";\n` });

    await expect(
      resolveAnchor(root, {
        file: "src/keys.ts",
        line: 1,
        text: `export const apiKey = "${secret}";`,
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("resolveAnchor with an unreadable file", () => {
  it("rejects missing, escaping and filtered files without throwing", async () => {
    const root = await createRepo();

    for (const file of ["src/missing.ts", "../outside.ts", ".env"]) {
      await expect(resolveAnchor(root, { file, symbol: "x" })).resolves.toMatchObject({
        ok: false,
      });
      await expect(resolveAnchor(root, { file, line: 1, text: "x" })).resolves.toMatchObject({
        ok: false,
      });
    }
  });
});

describe("resolveAnchor over the basic fixture", () => {
  it("resolves both anchor forms", async () => {
    await expect(
      resolveAnchor(fixtureRoot, { file: "src/clip-service.ts", symbol: "ClipService.save" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/clip-service.ts", start: 2, end: 4, capped: false },
    });
    await expect(
      resolveAnchor(fixtureRoot, { file: "src/upload.ts", line: 1, text: "return path;" }),
    ).resolves.toEqual({
      ok: true,
      value: { file: "src/upload.ts", start: 2, end: 2, capped: false },
    });
  });
});
