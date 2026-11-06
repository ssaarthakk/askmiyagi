import { glob } from "node:fs/promises";
import { posix, sep } from "node:path";
import { z } from "zod";
import type { Result } from "../../shared/result.ts";
import { isVisible } from "../files/file-filter.ts";
import { readRedactedFile } from "../files/path-guard.ts";

const workspacesSchema = z.object({
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
    .optional(),
});

async function readText(root: string, path: string) {
  const file = await readRedactedFile(root, path);
  return file.ok ? file.value.source : undefined;
}

function npmPatterns(source: string) {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return [];
  }
  const parsed = workspacesSchema.safeParse(json);
  const workspaces = parsed.success ? parsed.data.workspaces : undefined;
  return Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
}

function pnpmPatterns(source: string) {
  const patterns: string[] = [];
  let inPackages = false;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (/^[^\s-]/.test(line)) {
      inPackages = /^packages:$/.test(line);
      continue;
    }
    const item = inPackages ? line.match(/^\s*-\s+(.+)$/) : null;
    if (item?.[1]) patterns.push(item[1].trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return patterns;
}

export async function findApps(root: string): Promise<string[]> {
  const packageSource = await readText(root, "package.json");
  const pnpmSource = await readText(root, "pnpm-workspace.yaml");
  const patterns = [
    ...(packageSource === undefined ? [] : npmPatterns(packageSource)),
    ...(pnpmSource === undefined ? [] : pnpmPatterns(pnpmSource)),
  ].map((pattern) => pattern.replace(/^\.\//, "").replace(/\/+$/, ""));
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excluded = patterns.filter((pattern) => pattern.startsWith("!")).map((p) => p.slice(1));
  if (included.length === 0) return [];

  const apps = new Set<string>();
  const manifests = glob(
    included.map((pattern) => `${pattern}/package.json`),
    { cwd: root, exclude: ["**/node_modules", ...excluded] },
  );
  for await (const manifest of manifests) {
    const manifestPath = manifest.split(sep).join("/");
    if (!(await isVisible(root, manifestPath))) continue;
    const folder = posix.dirname(manifestPath);
    if (folder !== ".") apps.add(folder);
  }
  return [...apps].sort();
}

function listApps(apps: string[]) {
  return apps.map((app) => `  ${app}`).join("\n");
}

export async function chooseApp(options: {
  apps: string[];
  requested?: string | undefined;
  ask?: ((question: string) => Promise<string>) | undefined;
}): Promise<Result<string | undefined>> {
  const { apps, requested, ask } = options;
  const app =
    requested === undefined
      ? undefined
      : posix.normalize(requested.replaceAll("\\", "/")).replace(/\/+$/, "");
  if (app === ".") return { ok: true, value: undefined };
  if (apps.length === 0) {
    return app === undefined
      ? { ok: true, value: undefined }
      : { ok: false, error: "--app needs an npm, pnpm or yarn workspaces repo; none found" };
  }
  if (app !== undefined) {
    return apps.includes(app)
      ? { ok: true, value: app }
      : { ok: false, error: `Unknown app: ${requested}\nApps:\n${listApps(apps)}` };
  }
  if (!ask) {
    return {
      ok: false,
      error: `This repo has several apps; pick one with --app <folder>, or --app . for the whole repo:\n${listApps(apps)}`,
    };
  }
  const numbered = apps.map((app, index) => `  ${index + 1}) ${app}`).join("\n");
  const answer = (await ask(`Pick an app:\n  0) The whole repo\n${numbered}\nNumber: `)).trim();
  if (answer === "0") return { ok: true, value: undefined };
  const chosen = /^\d+$/.test(answer) ? apps[Number(answer) - 1] : undefined;
  return chosen === undefined
    ? { ok: false, error: `Choose a number from 0 to ${apps.length}` }
    : { ok: true, value: chosen };
}
