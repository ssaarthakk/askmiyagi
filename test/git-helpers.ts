import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir } from "./temp-dir.ts";

export function git(root: string, ...args: string[]) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

export function commitAll(root: string, message: string) {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

export async function createRepo() {
  const root = await tempDir();
  git(root, "init", "-q", "-b", "main");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "upload.ts"), "export const limit = 1\n");
  await writeFile(join(root, "src", "old.ts"), "export const old = true\n");
  await writeFile(join(root, ".env"), "TOKEN=first\n");
  await writeFile(join(root, "package-lock.json"), '{"lock":1}\n');
  commitAll(root, "add upload");
  return root;
}

export async function githubRemoteConfig(bareRepo: string) {
  const config = join(await tempDir(), "gitconfig");
  await writeFile(
    config,
    `[url "${pathToFileURL(bareRepo).href}"]\n\tinsteadOf = https://github.com/octo/remote.git\n`,
  );
  return config;
}
