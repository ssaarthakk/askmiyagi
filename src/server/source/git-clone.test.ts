import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloneRepository, openGitClone } from "./git-clone.ts";

const folders: string[] = [];
let bareRepo: string;

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
}

async function createFolder() {
  const folder = await mkdtemp(join(tmpdir(), "miyagi-git-clone-"));
  folders.push(folder);
  return folder;
}

beforeAll(async () => {
  const work = await createFolder();
  git(work, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(work, "first.ts"), "export const first = 1;\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "first");
  await writeFile(join(work, "second.ts"), "export const second = 2;\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "second");
  bareRepo = join(await createFolder(), "remote.git");
  git(work, "clone", "--quiet", "--bare", work, bareRepo);
});

afterAll(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("cloneRepository", () => {
  it("shallow-clones a repository into a real absolute folder", async () => {
    const result = await cloneRepository(
      pathToFileURL(bareRepo).href,
      new AbortController().signal,
    );

    if (!result.ok) throw new Error(result.error);
    try {
      const { root } = result.value;
      expect(isAbsolute(root)).toBe(true);
      expect(root).toBe(await realpath(root));
      const content = await readFile(join(root, "second.ts"), "utf8");
      expect(content.trim()).toBe("export const second = 2;");
      expect(git(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    } finally {
      await result.value.dispose();
    }
  });

  it("deletes the temp folder on dispose", async () => {
    const result = await cloneRepository(
      pathToFileURL(bareRepo).href,
      new AbortController().signal,
    );
    if (!result.ok) throw new Error(result.error);

    await result.value.dispose();

    await expect(stat(result.value.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not run the LFS smudge filter while cloning", async () => {
    const work = await createFolder();
    git(work, "init", "--quiet", "--initial-branch=main");
    await writeFile(join(work, ".gitattributes"), "*.bin filter=lfs\n");
    await writeFile(join(work, "asset.bin"), "not really an lfs pointer\n");
    git(work, "add", ".");
    git(work, "commit", "--quiet", "-m", "lfs");
    const lfsRepo = join(await createFolder(), "lfs.git");
    git(work, "clone", "--quiet", "--bare", work, lfsRepo);
    const globalConfig = join(await createFolder(), "gitconfig");
    await writeFile(
      globalConfig,
      '[filter "lfs"]\n\tsmudge = exit 1\n\tprocess = exit 1\n\trequired = true\n',
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");

    try {
      const result = await cloneRepository(
        pathToFileURL(lfsRepo).href,
        new AbortController().signal,
      );

      if (!result.ok) throw new Error(result.error);
      await result.value.dispose();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not clone submodules", async () => {
    const work = await createFolder();
    git(work, "init", "--quiet", "--initial-branch=main");
    git(
      work,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      pathToFileURL(bareRepo).href,
      "sub",
    );
    git(work, "commit", "--quiet", "-m", "submodule");
    const parentRepo = join(await createFolder(), "parent.git");
    git(work, "clone", "--quiet", "--bare", work, parentRepo);
    const globalConfig = join(await createFolder(), "gitconfig");
    await writeFile(globalConfig, '[protocol "file"]\n\tallow = always\n');
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);

    try {
      const result = await cloneRepository(
        pathToFileURL(parentRepo).href,
        new AbortController().signal,
      );

      if (!result.ok) throw new Error(result.error);
      try {
        expect(await readdir(join(result.value.root, "sub"))).toEqual([]);
      } finally {
        await result.value.dispose();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stops and leaves no temp folder when the signal is aborted", async () => {
    const temp = await createFolder();
    vi.stubEnv("TMPDIR", temp);
    vi.stubEnv("TEMP", temp);
    vi.stubEnv("TMP", temp);

    try {
      const result = await cloneRepository(pathToFileURL(bareRepo).href, AbortSignal.abort());

      expect(result).toEqual({ ok: false, error: expect.stringMatching(/^Could not clone /) });
      expect(await readdir(temp)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reports a repository that cannot be cloned", async () => {
    const missing = pathToFileURL(join(await createFolder(), "missing.git")).href;

    const result = await cloneRepository(missing, new AbortController().signal);

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^Could not clone /) });
  });

  it("never asks a stored credential helper when the server wants a login", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="private"' }).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const folder = await createFolder();
    const marker = join(folder, "asked").replaceAll("\\", "/");
    const helper = join(folder, "helper.sh").replaceAll("\\", "/");
    await writeFile(helper, `touch "${marker}"\n`);
    const globalConfig = join(folder, "gitconfig");
    await writeFile(globalConfig, `[credential]\n\thelper = "!sh \\"${helper}\\""\n`);
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);

    try {
      const result = await cloneRepository(
        `http://127.0.0.1:${port}/octo/private.git`,
        new AbortController().signal,
      );

      expect(result.ok).toBe(false);
      await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      vi.unstubAllEnvs();
      server.close();
    }
  });
});

describe("openGitClone", () => {
  it("shallow-clones a GitHub repository URL", async () => {
    const globalConfig = join(await createFolder(), "gitconfig");
    const missingFolder = pathToFileURL(join(await createFolder(), "missing")).href;
    await writeFile(
      globalConfig,
      [
        `[url "${pathToFileURL(bareRepo).href}"]`,
        "\tinsteadOf = https://github.com/octo/remote.git",
        `[url "${missingFolder}/"]`,
        "\tinsteadOf = https://github.com/",
        "",
      ].join("\n"),
    );
    vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);

    try {
      const result = await openGitClone(
        "https://github.com/octo/remote/",
        new AbortController().signal,
      );

      if (!result.ok) throw new Error(result.error);
      try {
        const { root } = result.value;
        const content = await readFile(join(root, "first.ts"), "utf8");
        expect(content.trim()).toBe("export const first = 1;");
        expect(git(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
      } finally {
        await result.value.dispose();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses a URL that is not a public GitHub repository without cloning", async () => {
    const url = pathToFileURL(bareRepo).href;

    await expect(openGitClone(url, new AbortController().signal)).resolves.toEqual({
      ok: false,
      error: `Only https://github.com/<owner>/<repo> URLs can be cloned: ${url}`,
    });
  });
});
