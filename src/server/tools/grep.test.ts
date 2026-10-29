import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { grepTool } from "./grep.ts";

const fixtureRoot = fileURLToPath(new URL("../../../test/fixtures/basic/", import.meta.url));
const roots: string[] = [];

async function createRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-grep-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(root, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("grep tool", () => {
  it("searches patterns with flags and include and exclude globs", async () => {
    const root = await createRepo({
      "src/upload.ts": "export function uploadClip() { return 'ready'; } // upload\n",
      "src/archive.ts": "export function ArchiveClip() { return 'ready'; } // ARCHIVE\n",
      "src/uploads.ts": "uploads are not a whole word match\n",
      "src/upload.test.ts": "upload should work\n",
      "docs/upload.md": "upload should work\n",
    });

    const result = await grepTool(root, {
      patterns: ["upload", "archive"],
      caseInsensitive: true,
      wholeWord: true,
      include: ["src/**/*.ts"],
      exclude: ["*.test.ts"],
    });

    expect(result).toEqual({
      isError: false,
      text: [
        "src/archive.ts",
        "  1: export function ArchiveClip() { return 'ready'; } // ARCHIVE",
        "src/upload.ts",
        "  1: export function uploadClip() { return 'ready'; } // upload",
      ].join("\n"),
    });
  });

  it("redacts private key lines that match", async () => {
    const root = await createRepo({
      "src/keys.ts": [
        "export const pem = `",
        ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
        "MIIEvQIBADANBgkqhkiG9w0needle",
        ["-----END ", "PRIVATE KEY-----"].join(""),
        "`;",
      ].join("\n"),
    });

    const result = await grepTool(root, { patterns: ["needle"] });

    expect(result).toEqual({ isError: false, text: "No matches." });
  });

  it("does not reveal secrets through matches inside redacted text", async () => {
    const root = await createRepo({
      "src/config.ts": 'const key = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";\nconst skip = 1;\n',
    });

    const guess = await grepTool(root, { patterns: ["sk-ant-abc"] });
    const visible = await grepTool(root, { patterns: ["sk"], caseInsensitive: true });

    expect(guess).toEqual({ isError: false, text: "No matches." });
    expect(visible.text).toBe("src/config.ts\n  2: const skip = 1;");
  });

  it("gives the same answer whether a guess at a redacted secret is right or wrong", async () => {
    const root = await createRepo({
      "src/config.ts": 'const skip = 1; const key = "sk-ant-abcdefghijklmnopqrstuvwxyz0123";\n',
    });

    const rightAlternation = await grepTool(root, { patterns: ["skip", "sk-ant-abc"] });
    const wrongAlternation = await grepTool(root, { patterns: ["skip", "sk-ant-abd"] });
    const rightOptional = await grepTool(root, { patterns: ['key = "(sk-ant-abc)?'] });
    const wrongOptional = await grepTool(root, { patterns: ['key = "(sk-ant-abd)?'] });

    expect(rightAlternation).toEqual(wrongAlternation);
    expect(rightAlternation.text).toBe(
      'src/config.ts\n  1: const skip = 1; const key = "[REDACTED]";',
    );
    expect(rightOptional).toEqual(wrongOptional);
  });

  it("reports line numbers per file across many files and line endings", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 150 }, (_, index) => [
        `${String(index).padStart(3, "0")}-${"x".repeat(170)}.md`,
        "needle\n",
      ]),
    );
    const root = await createRepo({
      ...files,
      "src/a.ts": "one\r\ntwo\r\nneedle\r\n",
      "src/b.ts": "",
      "src/c.ts": "needle\nlast needle",
      "src/d.ts": "x\n\nneedle\n",
    });

    const many = await grepTool(root, { patterns: ["needle"] });
    const sources = await grepTool(root, { patterns: ["needle"], include: ["src/**"] });

    expect(many.text).toContain("50 of 154");
    expect(many.text).toContain(`149-${"x".repeat(170)}.md: 1`);
    expect(sources.text).toBe(
      [
        "src/a.ts",
        "  3: needle",
        "src/c.ts",
        "  1: needle",
        "  2: last needle",
        "src/d.ts",
        "  3: needle",
      ].join("\n"),
    );
  }, 30_000);

  it("returns an error when the search runs past its time limit", async () => {
    const root = await createRepo({ "src/a.ts": "needle\n" });
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());

    try {
      await expect(grepTool(root, { patterns: ["needle"] })).resolves.toEqual({
        isError: true,
        text: "Search timed out after 30 s",
      });
    } finally {
      timeout.mockRestore();
    }
  });

  it("searches the basic fixture with source files before tests", async () => {
    const result = await grepTool(fixtureRoot, { patterns: ["export"] });

    expect(result).toEqual({
      isError: false,
      text: [
        "src/clip-service.ts",
        "  1: export class ClipService {",
        "src/upload.ts",
        "  1: export async function uploadClip(path: string) {",
        "src/clip-service.test.ts",
        "  1: export {};",
      ].join("\n"),
    });
  });

  it("orders paths by code point, independent of locale", async () => {
    const result = await grepTool(fixtureRoot, { patterns: ["upload"] });

    expect(result.text).toBe(
      [
        "README.md",
        "  1: This small project demonstrates a clip upload service with a few source files for Miyagi to inspect.",
        "notes.md",
        "  1: Clips are saved after upload.",
        "src/upload.ts",
        "  1: export async function uploadClip(path: string) {",
      ].join("\n"),
    );
  });

  it("drops filtered files and sorts source files before tests", async () => {
    const root = await createRepo({
      "test/first.ts": "needle\n",
      "src/zeta.test.ts": "needle\n",
      "src/beta.ts": "needle\n",
      "src/.gitignore": "hidden.ts\n",
      "src/hidden.ts": "needle\n",
      "src/.env": "needle\n",
    });

    const result = await grepTool(root, { patterns: ["needle"] });

    expect(result.text).toBe(
      [
        "src/beta.ts",
        "  1: needle",
        "src/zeta.test.ts",
        "  1: needle",
        "test/first.ts",
        "  1: needle",
      ].join("\n"),
    );
    expect(result.text).not.toContain("hidden.ts");
    expect(result.text).not.toContain(".env");
  });

  it("caps matches at 50 and reports the total and per-file counts", async () => {
    const root = await createRepo({
      "src/many.ts": Array.from({ length: 55 }, (_, index) => `needle ${index + 1}`).join("\n"),
    });

    const result = await grepTool(root, { patterns: ["needle"] });

    expect(result.text).toContain("50 of 55");
    expect(result.text).toContain("src/many.ts: 55");
    expect(result.text).toContain("  50: needle 50");
    expect(result.text).not.toContain("  51: needle 51");
  });

  it("cuts long lines, redacts secrets, and reports invalid patterns", async () => {
    const secret = "aB3$dE6@gH9#jK2%mN5!".repeat(16);
    const root = await createRepo({
      "src/config.ts": `${"x".repeat(170)} const apiKey = "${secret}"; ${"x".repeat(300)}\n`,
    });

    const match = await grepTool(root, { patterns: ["apiKey"] });
    const invalid = await grepTool(root, { patterns: ["["] });

    expect(match.text).toContain("[REDACTED]");
    expect(match.text).toContain("…");
    expect(match.text).not.toContain(secret.slice(0, 30));
    expect(match.text.length).toBeLessThan(240);
    expect(invalid).toMatchObject({ isError: true });
  });

  it("reports invalid patterns for an empty repository", async () => {
    const root = await createRepo({});

    const result = await grepTool(root, { patterns: ["["] });

    expect(result.isError).toBe(true);
  });
});
