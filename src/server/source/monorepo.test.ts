import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { chooseApp, findApps } from "./monorepo.ts";

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split("/")), content);
  }
}

const packageFile = '{ "name": "app" }';

describe("findApps", () => {
  it("expands npm workspace globs and skips folders without a package.json", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      "package.json": '{ "workspaces": ["packages/*"] }',
      "packages/web/package.json": packageFile,
      "packages/api/package.json": packageFile,
      "packages/docs/readme.md": "docs",
      "packages/notes.md": "notes",
    });

    await expect(findApps(root)).resolves.toEqual(["packages/api", "packages/web"]);
  });

  it("reads the yarn object form of workspaces", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      "package.json": '{ "workspaces": { "packages": ["apps/*"] } }',
      "apps/web/package.json": packageFile,
    });

    await expect(findApps(root)).resolves.toEqual(["apps/web"]);
  });

  it("reads pnpm-workspace.yaml with comments, quotes and exclusions", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      "pnpm-workspace.yaml": [
        "# workspaces",
        "packages:",
        "  - 'apps/*' # the apps",
        '  - "libs/*"',
        "  - '!libs/legacy'",
        "catalog:",
        "  - 'ignored/*'",
        "",
      ].join("\n"),
      "apps/web/package.json": packageFile,
      "libs/ui/package.json": packageFile,
      "libs/legacy/package.json": packageFile,
      "ignored/tool/package.json": packageFile,
    });

    await expect(findApps(root)).resolves.toEqual(["apps/web", "libs/ui"]);
  });

  it("reads pnpm list items written at the start of the line", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      "pnpm-workspace.yaml": "packages:\n- apps/*\n",
      "apps/web/package.json": packageFile,
    });

    await expect(findApps(root)).resolves.toEqual(["apps/web"]);
  });

  it("never returns the root or folders inside node_modules", async () => {
    const root = await tempDir();
    await writeFiles(root, {
      "package.json": '{ "workspaces": ["**"] }',
      "apps/web/package.json": packageFile,
      "apps/web/node_modules/left-pad/package.json": packageFile,
    });

    await expect(findApps(root)).resolves.toEqual(["apps/web"]);
  });

  it("offers only folders inside the root that the file filter can see", async () => {
    const parent = await tempDir();
    const root = join(parent, "repo");
    await writeFiles(parent, {
      "outside/package.json": packageFile,
      "repo/package.json": '{ "workspaces": ["../*", "apps/*"] }',
      "repo/.gitignore": "apps/generated/\n",
      "repo/apps/web/package.json": packageFile,
      "repo/apps/generated/package.json": packageFile,
    });

    await expect(findApps(root)).resolves.toEqual(["apps/web"]);
  });

  it("finds no apps without workspaces or with a package.json it cannot use", async () => {
    const plain = await tempDir();
    await writeFiles(plain, { "package.json": '{ "name": "plain" }' });
    const broken = await tempDir();
    await writeFiles(broken, {
      "package.json": "{ not json",
      "apps/web/package.json": packageFile,
    });
    const odd = await tempDir();
    await writeFiles(odd, { "package.json": '{ "workspaces": 3 }' });
    const empty = await tempDir();

    for (const root of [plain, broken, odd, empty]) {
      await expect(findApps(root)).resolves.toEqual([]);
    }
  });
});

describe("chooseApp", () => {
  const apps = ["apps/api", "apps/web"];

  it("needs no app when there are no workspaces", async () => {
    await expect(chooseApp({ apps: [] })).resolves.toEqual({ ok: true, value: undefined });
  });

  it("refuses --app when there are no workspaces", async () => {
    const result = await chooseApp({ apps: [], requested: "apps/web" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("workspaces") });
  });

  it("accepts a requested app, tolerating backslashes, ./ and a trailing slash", async () => {
    for (const requested of ["apps/web", "./apps/web/", "apps\\web"]) {
      await expect(chooseApp({ apps, requested })).resolves.toEqual({
        ok: true,
        value: "apps/web",
      });
    }
  });

  it("rejects an unknown app and lists the apps", async () => {
    const result = await chooseApp({ apps, requested: "apps/mobile" });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("apps/mobile");
    expect(result.error).toContain("apps/api");
    expect(result.error).toContain("apps/web");
  });

  it("lists the apps and asks for --app when nobody can be prompted", async () => {
    const result = await chooseApp({ apps });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("--app");
    expect(result.error).toContain("apps/api");
    expect(result.error).toContain("apps/web");
  });

  it("prompts with a numbered list and returns the chosen app", async () => {
    const questions: string[] = [];
    const result = await chooseApp({
      apps,
      ask: (question) => {
        questions.push(question);
        return Promise.resolve(" 2 ");
      },
    });

    expect(result).toEqual({ ok: true, value: "apps/web" });
    expect(questions[0]).toContain("1) apps/api");
    expect(questions[0]).toContain("2) apps/web");
  });

  it("rejects an answer that is not on the list", async () => {
    for (const answer of ["", "0", "3", "web", "1.5"]) {
      const result = await chooseApp({ apps, ask: () => Promise.resolve(answer) });
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("1 to 2") });
    }
  });
});
