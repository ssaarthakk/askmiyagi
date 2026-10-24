import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepoMap } from "./repo-map.ts";

const roots: string[] = [];

async function createRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-repo-map-budget-"));
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

describe("repo map budget", () => {
  it("drops signatures from less referenced files first and is deterministic", async () => {
    const root = await createRepo({
      "src/a-common/index.mts":
        "export function commonFirst(): void {}\nexport function commonSecond(): void {}",
      "src/z-rare.ts":
        "export function rareFirst(): void {}\nexport function rareSecond(): void {}",
      "src/use-one.ts": 'import { commonFirst } from "./a-common";\ncommonFirst();',
      "src/use-two.ts": 'import { commonSecond } from "./a-common";\ncommonSecond();',
    });

    const fullMap = await buildRepoMap(root);
    const budget = Math.floor((fullMap.length - 1) / 4);
    const first = await buildRepoMap(root, budget);
    const second = await buildRepoMap(root, budget);

    expect(second).toBe(first);
    expect(first).toContain("export function commonFirst(): void");
    expect(first).toContain("export function commonSecond(): void");
    expect(first).toContain("export function rareFirst(): void");
    expect(first).not.toContain("export function rareSecond(): void");
  });

  it("does not count import-like strings when prioritizing signatures", async () => {
    const root = await createRepo({
      "src/a-common.ts":
        "export function commonFirst(): void {}\nexport function commonSecond(): void {}",
      "src/z-rare.ts":
        "export function rareFirst(): void {}\nexport function rareSecond(): void {}",
      "src/use.ts": 'import { commonFirst } from "./a-common";\ncommonFirst();',
      "src/fake-a.ts": "const example = \"import { fake } from './z-rare'\";",
      "src/fake-b.ts": "const example = \"import { fake } from './z-rare'\";",
    });

    const fullMap = await buildRepoMap(root);
    const budget = Math.floor((fullMap.length - 1) / 4);
    const map = await buildRepoMap(root, budget);

    expect(map).toContain("export function commonFirst(): void");
    expect(map).toContain("export function commonSecond(): void");
    expect(map).toContain("export function rareFirst(): void");
    expect(map).not.toContain("export function rareSecond(): void");
  });

  it("collapses the deepest folder before its parents when the tree exceeds the budget", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [`src/deep/file-${index}.md`, "note"]),
    );
    const root = await createRepo({ ...files, "src/other.md": "note" });

    const map = await buildRepoMap(root, 20);

    expect(map).toContain("src/");
    expect(map).toContain("deep/ (6 files)");
    expect(map).toContain("other.md");
  });

  it("collapses the deepest folder even when a shallower one sorts first", async () => {
    const root = await createRepo({ "src/a/b/x.md": "x", "src/z/y/w/v.md": "v" });

    const fullMap = await buildRepoMap(root);
    const map = await buildRepoMap(root, Math.floor((fullMap.length - 1) / 4));

    expect(map).toContain("w/ (1 files)");
    expect(map).toContain("    x.md");
  });

  it("keeps the output within budget when a long README and root files fill the map", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`file-${index}.md`, "note"]),
    );
    const root = await createRepo({
      ...files,
      "README.md": `${"A".repeat(1000)}\n\nIgnored later paragraph.`,
    });

    const map = await buildRepoMap(root, 80);

    expect(map.length).toBeLessThanOrEqual(320);
    expect(map).toContain("./ (31 files)");
    expect(map).toContain("## README");
  });
});
