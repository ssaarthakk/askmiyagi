import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isVisible, listVisibleFiles } from "./file-filter.ts";

const fixture = resolve(import.meta.dirname, "../../../test/fixtures/basic");
const temporaryRoots: string[] = [];

async function makeProject() {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-filter-"));
  const root = join(parent, "project");
  temporaryRoots.push(parent);
  await cp(fixture, root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("shared file filter", () => {
  it("applies nested gitignore rules and returns visible files in sorted order", async () => {
    const root = await makeProject();
    await writeFile(join(root, "src", "draft.tmp"), "temporary\n");
    await writeFile(join(root, "src", "keep.ts"), "export const keep = true;\n");
    await mkdir(join(root, "src", "nested"));
    await writeFile(join(root, "src", "nested", "draft.tmp"), "temporary\n");

    await expect(isVisible(root, "src/draft.tmp")).resolves.toBe(false);
    await expect(isVisible(root, "src/nested/draft.tmp")).resolves.toBe(false);
    await expect(isVisible(root, "src/keep.ts")).resolves.toBe(true);

    const files = await listVisibleFiles(root);
    expect(files).toEqual([...files].sort());
    expect(files).not.toContain("src/draft.tmp");
    expect(files).not.toContain("src/nested/draft.tmp");
    expect(files).toContain("src/keep.ts");
  });

  it("lets nested rules override a parent and keeps ignored directories hidden", async () => {
    const root = await makeProject();
    await writeFile(join(root, ".gitignore"), "*.tmp\n");
    await writeFile(join(root, "src", ".gitignore"), "!draft.tmp\n");
    await writeFile(join(root, "src", "draft.tmp"), "temporary\n");
    await expect(isVisible(root, "src/draft.tmp")).resolves.toBe(true);

    await writeFile(join(root, ".gitignore"), "/src\n");
    await writeFile(join(root, "src", ".gitignore"), "!clip-service.ts\n");
    await expect(isVisible(root, "src/clip-service.ts")).resolves.toBe(false);
  });

  it("does not read ignore configuration through links outside the project", async ({ skip }) => {
    const root = await makeProject();
    const outsideGitignore = join(root, "..", "outside.gitignore");
    const outsideAttributes = join(root, "..", "outside.gitattributes");
    await writeFile(outsideGitignore, "*.ts\n");
    await writeFile(outsideAttributes, "src/external.ts linguist-generated\n");
    try {
      await symlink(outsideGitignore, join(root, ".gitignore"), "file");
      await symlink(outsideAttributes, join(root, ".gitattributes"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") skip();
      throw error;
    }
    await writeFile(join(root, "src", "external.ts"), "export const visible = true;\n");

    await expect(isVisible(root, "src/external.ts")).resolves.toBe(true);
  });

  it("reports an oversized ignore configuration clearly", async () => {
    const root = await makeProject();
    await writeFile(join(root, ".gitignore"), Buffer.alloc(1024 * 1024 + 1, 42));

    await expect(isVisible(root, "src/clip-service.ts")).rejects.toThrow(
      "Project config exceeds 1 MB: .gitignore",
    );
  });

  it("excludes repository metadata, dependency and build folders at every depth", async () => {
    const root = await makeProject();
    const excludedFolders = [".git", "node_modules", "dist", "build", "out", ".next", "coverage"];
    for (const folder of excludedFolders) {
      const directory = join(root, "src", "nested", folder);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "hidden.ts"), "export const hidden = true;\n");
    }

    const files = await listVisibleFiles(root);
    for (const folder of excludedFolders) {
      expect(files).not.toContain(`src/nested/${folder}/hidden.ts`);
      await expect(isVisible(root, `src/nested/${folder}/hidden.ts`)).resolves.toBe(false);
    }
  });

  it("excludes lockfiles and secret files", async () => {
    const root = await makeProject();
    const excludedFiles = [
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "bun.lock",
      "bun.lockb",
      "Cargo.lock",
      "poetry.lock",
      "Pipfile.lock",
      "composer.lock",
      "Gemfile.lock",
      "go.sum",
      ".env",
      ".env.local",
      "server.pem",
      "server.key",
      "id_rsa",
      "id_rsa.pub",
      "identity.p12",
      "identity.pfx",
    ];
    for (const path of excludedFiles) {
      await writeFile(join(root, path), "private\n");
    }

    for (const path of excludedFiles) {
      await expect(isVisible(root, path)).resolves.toBe(false);
    }
    const files = await listVisibleFiles(root);
    for (const path of excludedFiles) expect(files).not.toContain(path);
  });

  it("hides secret files whatever the case of their names", async () => {
    const root = await makeProject();
    for (const name of [".ENV", ".Env.local", "ID_RSA", "KEY.PEM"]) {
      await writeFile(join(root, name), "secret\n");
      await expect(isVisible(root, name)).resolves.toBe(false);
    }
  });

  it("keeps .env.example visible as the one allowed env file", async () => {
    const root = await makeProject();
    await writeFile(join(root, ".env.example"), "API_URL=\n");
    await writeFile(join(root, ".env.example.local"), "private\n");

    await expect(isVisible(root, ".env.example")).resolves.toBe(true);
    await expect(isVisible(root, ".env.example.local")).resolves.toBe(false);
  });

  it("excludes generated markers, binary files, and files over one megabyte", async () => {
    const root = await makeProject();
    await writeFile(
      join(root, ".gitattributes"),
      "src/schema.gen.ts linguist-generated\nsrc/explicit.gen.ts linguist-generated=true\n",
    );
    await writeFile(join(root, "src", "explicit.gen.ts"), "export const generated = true;\n");
    await writeFile(join(root, "src", "manual.ts"), "DO NOT EDIT\nexport const manual = true;\n");
    await writeFile(
      join(root, "src", "later-marker.ts"),
      "line 1\nline 2\nline 3\nline 4\nline 5\nDO NOT EDIT\n",
    );
    await writeFile(join(root, "src", "exact-limit.ts"), Buffer.alloc(1024 * 1024, 97));
    await writeFile(join(root, "src", "too-large.ts"), Buffer.alloc(1024 * 1024 + 1, 97));
    await writeFile(join(root, "src", "binary.bin"), Buffer.from([97, 0, 98]));
    await writeFile(
      join(root, "src", "late-null.bin"),
      Buffer.concat([Buffer.alloc(8192, 97), Buffer.from([0])]),
    );

    await expect(isVisible(root, "src/generated.ts")).resolves.toBe(false);
    await expect(isVisible(root, "src/schema.gen.ts")).resolves.toBe(false);
    await expect(isVisible(root, "src/explicit.gen.ts")).resolves.toBe(false);
    await expect(isVisible(root, "src/manual.ts")).resolves.toBe(false);
    await expect(isVisible(root, "src/later-marker.ts")).resolves.toBe(true);
    await expect(isVisible(root, "src/exact-limit.ts")).resolves.toBe(true);
    await expect(isVisible(root, "src/too-large.ts")).resolves.toBe(false);
    await expect(isVisible(root, "src/binary.bin")).resolves.toBe(false);
    await expect(isVisible(root, "src/late-null.bin")).resolves.toBe(true);
  });
});
