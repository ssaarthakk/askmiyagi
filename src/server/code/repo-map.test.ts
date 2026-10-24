import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepoMap } from "./repo-map.ts";

const fixtureRoot = fileURLToPath(new URL("../../../test/fixtures/basic/", import.meta.url));
const roots: string[] = [];

async function createRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-repo-map-"));
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

describe("repo map", () => {
  it("summarizes visible files, declarations, package metadata, README and config files", async () => {
    const root = await createRepo({
      "package.json": JSON.stringify({
        name: "basic",
        scripts: { build: "tsc", test: "vitest run" },
        dependencies: { zod: "4.6.7" },
        devDependencies: { vitest: "4.0.0" },
      }),
      "README.md": "A voice tutor for code.\n\nMore detail here.",
      "tsconfig.json": "{}",
      ".env.example": "API_URL=",
      "src/clip-service.ts": [
        "export interface Clip {",
        "  path: string;",
        "}",
        "export type ClipId = string;",
        "export class ClipService {",
        "  save(clip: Clip): Promise<void> { return Promise.resolve(); }",
        "}",
        "export async function uploadClip(path: string): Promise<Clip> { return { path }; }",
        "export const clipName = (path: string) => path;",
      ].join("\n"),
      "notes.md": "Notes",
      "src/.env": "hidden",
    });

    await expect(buildRepoMap(root)).resolves.toBe(
      [
        "## Files",
        "src/",
        "  clip-service.ts",
        "    export interface Clip",
        "      path: string",
        "    export type ClipId = string;",
        "    export class ClipService",
        "      save(clip: Clip): Promise<void>",
        "    export async function uploadClip(path: string): Promise<Clip>",
        "    export const clipName = (path: string) =>",
        ".env.example",
        "README.md",
        "notes.md",
        "package.json",
        "tsconfig.json",
        "## package.json",
        "name: basic",
        "scripts: build, test",
        "dependencies: vitest, zod",
        "## README",
        "A voice tutor for code.",
        "## Config files",
        ".env.example",
        "tsconfig.json",
      ].join("\n"),
    );
  });

  it("keeps exported const signatures separate and preserves default exports", async () => {
    const root = await createRepo({
      "src/api.ts": [
        'export const first = () => { throw new Error("first body"); }, second = () => { throw new Error("second body"); };',
        "export default function load(path: string): string { return path; }",
        "export default class Loader { run(): void {} }",
      ].join("\n"),
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("export const first = () =>");
    expect(map).toContain("export const second = () =>");
    expect(map).toContain("export default function load(path: string): string");
    expect(map).toContain("export default class Loader");
    expect(map).not.toContain("first body");
    expect(map).not.toContain("second body");
  });

  it("extracts function, class, method and exported const signatures from JavaScript", async () => {
    const root = await createRepo({
      "src/client.js": [
        "export function start(path) { return path; }",
        "export class Client { send(value) { return value; } }",
        "export const getName = (value) => value;",
      ].join("\n"),
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("export function start(path)");
    expect(map).toContain("export class Client");
    expect(map).toContain("send(value)");
    expect(map).toContain("export const getName = (value) =>");
  });

  it("finds the first README paragraph when it follows a heading without a blank line", async () => {
    const root = await createRepo({
      "README.md": "# Project title\nShort description of the project.\n\nLater paragraph.",
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("## README\nShort description of the project.");
    expect(map).not.toContain("Later paragraph.");
  });

  it("redacts private keys inside signatures", async () => {
    const root = await createRepo({
      "src/keys.ts": [
        "export const pem = `",
        ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
        "private material",
        ["-----END ", "PRIVATE KEY-----"].join(""),
        "`;",
      ].join("\n"),
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("    export const pem\n");
    expect(map).not.toContain("private material");
  });

  it("lists abstract classes, generators and ambient functions", async () => {
    const root = await createRepo({
      "src/shapes.ts": [
        "export abstract class Shape { abstract area(): number; }",
        "export function* generateIds() { yield 1; }",
        "declare function ambientLoad(path: string): void;",
      ].join("\n"),
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("    export abstract class Shape\n      abstract area(): number");
    expect(map).toContain("    export function* generateIds()");
    expect(map).toContain("    declare function ambientLoad(path: string): void;");
  });

  it("keeps exported values out of variable signatures", async () => {
    const root = await createRepo({
      "src/button.tsx":
        "export const Button = forwardRef((props, ref) => { return renderButtonBody(props); });\nexport let handler = () => { handlerBody(); };",
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("    export const Button\n");
    expect(map).toContain("    export let handler\n");
    expect(map).not.toContain("renderButtonBody");
    expect(map).not.toContain("handlerBody");
  });

  it("reads the first paragraph of a lowercase readme", async () => {
    const root = await createRepo({ "readme.md": "Lowercase readme text." });

    await expect(buildRepoMap(root)).resolves.toContain("## README\nLowercase readme text.");
  });

  it("still builds the map when package.json is invalid", async () => {
    const root = await createRepo({
      "package.json": "{ broken",
      "src/a.ts": "export function a() {}",
    });

    const map = await buildRepoMap(root);

    expect(map).toContain("## package.json\ninvalid\n");
    expect(map).toContain("export function a()");
  });

  it("maps the basic fixture", async () => {
    await expect(buildRepoMap(fixtureRoot)).resolves.toBe(
      [
        "## Files",
        "src/",
        "  .gitignore",
        "  clip-service.test.ts",
        "  clip-service.ts",
        "    export class ClipService",
        "      save(clip: string)",
        "  upload.ts",
        "    export async function uploadClip(path: string)",
        ".gitattributes",
        "README.md",
        "notes.md",
        "package.json",
        "## package.json",
        "name: basic",
        "scripts: build, test",
        "dependencies: zod",
        "## README",
        "This small project demonstrates a clip upload service with a few source files for Miyagi to inspect.",
        "## Config files",
      ].join("\n"),
    );
  });
});
