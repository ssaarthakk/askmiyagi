import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import ignore from "ignore";

const excludedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
]);

const excludedFiles = new Set([
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
]);
const configPatterns = [
  /^tsconfig.*\.json$/,
  /^vite\.config\./,
  /^next\.config\./,
  /^biome\.json$/,
  /^eslint\.config\./,
  /^\.eslintrc/,
  /^Dockerfile$/,
  /^docker-compose\./,
  /^compose\./,
  /^\.env\.example$/,
];
const maximumFileSize = 1024 * 1024;
const appFolders = new Map<string, string>();

export function isConfigFile(name: string) {
  return configPatterns.some((pattern) => pattern.test(name));
}

export function scopeToApp(root: string, app: string) {
  appFolders.set(root, app);
}

export function appFolder(root: string) {
  return appFolders.get(root);
}

function isInAppScope(root: string, relPath: string, isDirectory: boolean) {
  const app = appFolders.get(root);
  if (app === undefined || relPath === app || relPath.startsWith(`${app}/`)) return true;
  if (isDirectory) return app.startsWith(`${relPath}/`);
  return !relPath.includes("/") && isConfigFile(relPath);
}

function normalizeRelativePath(relPath: string) {
  if (isAbsolute(relPath) || win32.isAbsolute(relPath) || /^[a-z]:/i.test(relPath)) return null;
  const segments = relPath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function isExcludedName(relPath: string, isDirectory: boolean) {
  return relPath.split("/").some((segment, index, segments) => {
    if ((index < segments.length - 1 || isDirectory) && excludedDirectories.has(segment))
      return true;
    if (index !== segments.length - 1 || isDirectory) return false;
    const name = segment.toLowerCase();
    return (
      excludedFiles.has(segment) ||
      (/^\.env/.test(name) && name !== ".env.example") ||
      /\.(?:pem|key|p12|pfx)$/.test(name) ||
      /^id_rsa/.test(name)
    );
  });
}

async function readProjectConfig(root: string, relPath: string) {
  let absolutePath: string;
  try {
    absolutePath = await realpath(resolve(root, ...relPath.split("/")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const realRoot = await realpath(root);
  const pathFromRoot = relative(realRoot, absolutePath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot))
    return null;

  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) return null;
  if (fileStat.size > maximumFileSize) {
    throw new Error(`Project config exceeds 1 MB: ${relPath}`);
  }
  return readFile(absolutePath, "utf8");
}

async function matchesGitignore(root: string, relPath: string, isDirectory: boolean) {
  const segments = relPath.split("/");
  const matchers: { base: string[]; matcher: ReturnType<typeof ignore> }[] = [];

  async function loadMatcher(base: string[]) {
    const content = await readProjectConfig(root, [...base, ".gitignore"].join("/"));
    if (content === null) return;
    matchers.push({ base, matcher: ignore().add(content) });
  }

  function isIgnored(pathSegments: string[], directory: boolean) {
    let ignored = false;
    for (const { base, matcher } of matchers) {
      const localPath = pathSegments.slice(base.length).join("/") + (directory ? "/" : "");
      const match = matcher.test(localPath);
      if (match.ignored) ignored = true;
      if (match.unignored) ignored = false;
    }
    return ignored;
  }

  await loadMatcher([]);
  const parentSegments = segments.slice(0, -1);
  for (let index = 0; index < parentSegments.length; index += 1) {
    const directory = parentSegments.slice(0, index + 1);
    if (isIgnored(directory, true)) return true;
    await loadMatcher(directory);
  }

  return isIgnored(segments, isDirectory);
}

async function isGeneratedByAttributes(root: string, relPath: string) {
  const attributes = await readProjectConfig(root, ".gitattributes");
  if (attributes === null) return false;

  const patterns = attributes
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([pattern, ...rules]) =>
        pattern &&
        rules.some((rule) => rule === "linguist-generated" || rule === "linguist-generated=true"),
    )
    .map(([pattern]) => pattern ?? "");
  return patterns.length > 0 && ignore().add(patterns).ignores(relPath);
}

function isMissing(error: unknown) {
  const { code } = error as NodeJS.ErrnoException;
  return code === "ENOENT" || code === "ENOTDIR";
}

async function pathExists(root: string, relPath: string) {
  try {
    await lstat(resolve(root, ...relPath.split("/")));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function isVisibleName(root: string, relPath: string, isDirectory: boolean) {
  return (
    isInAppScope(root, relPath, isDirectory) &&
    !isExcludedName(relPath, isDirectory) &&
    !(await matchesGitignore(root, relPath, isDirectory))
  );
}

async function isVisiblePath(root: string, relPath: string, isDirectory: boolean) {
  if (!(await isVisibleName(root, relPath, isDirectory))) return false;

  let absolutePath: string;
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    absolutePath = await realpath(resolve(root, ...relPath.split("/")));
    fileStat = await stat(absolutePath);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }

  const realRoot = await realpath(root);
  const pathFromRoot = relative(realRoot, absolutePath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot))
    return false;
  if (isDirectory !== fileStat.isDirectory()) return false;
  if (isDirectory) return true;
  if (!fileStat.isFile()) return false;
  if (fileStat.size > maximumFileSize || (await isGeneratedByAttributes(root, relPath)))
    return false;

  const contents = await readFile(absolutePath);
  if (contents.subarray(0, 8192).includes(0)) return false;
  const firstLines = contents.toString("utf8").split(/\r?\n/).slice(0, 5);
  return !firstLines.some((line) => line.includes("@generated") || line.includes("DO NOT EDIT"));
}

export async function isVisible(root: string, relPath: string): Promise<boolean> {
  const normalizedPath = normalizeRelativePath(relPath);
  if (normalizedPath === null) return false;
  return isVisiblePath(root, normalizedPath, false);
}

export async function isVisibleInDiff(root: string, relPath: string): Promise<boolean> {
  const normalizedPath = normalizeRelativePath(relPath);
  if (normalizedPath === null) return false;
  if (await pathExists(root, normalizedPath)) return isVisiblePath(root, normalizedPath, false);
  return (
    (await isVisibleName(root, normalizedPath, false)) &&
    !(await isGeneratedByAttributes(root, normalizedPath))
  );
}

export async function listVisibleFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string, relDirectory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relPath = relDirectory ? `${relDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (await isVisiblePath(root, relPath, true)) {
          await walk(resolve(directory, entry.name), relPath);
        }
      } else if (entry.isFile() && (await isVisible(root, relPath))) {
        files.push(relPath);
      }
    }
  }

  await walk(await realpath(root), "");
  return files.sort();
}
