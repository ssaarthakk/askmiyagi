import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../../shared/result.ts";
import { withoutVoiceKey } from "../llm/claude-process.ts";
import { runGit } from "./git-process.ts";
import { parseGitHubUrl } from "./github-url.ts";
import type { CodeSource } from "./local-folder.ts";

const cloneTimeoutMs = 300_000;

const lockedDownArgs = [
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.required=false",
  "-c",
  "credential.helper=",
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function cloneRepository(
  cloneUrl: string,
  signal: AbortSignal,
): Promise<Result<CodeSource>> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "miyagi-clone-")));
  const root = join(folder, "repo");
  const dispose = () => rm(folder, { recursive: true, force: true, maxRetries: 3 });
  try {
    await runGit(
      [
        ...lockedDownArgs,
        "clone",
        "--depth",
        "1",
        "--no-recurse-submodules",
        "--quiet",
        "--",
        cloneUrl,
        root,
      ],
      {
        env: {
          ...withoutVoiceKey(process.env),
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
          GCM_INTERACTIVE: "Never",
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(cloneTimeoutMs)]),
      },
    );
  } catch (error) {
    const cleanup = await dispose().then(
      () => "",
      (rmError: unknown) => ` (and could not delete ${folder}: ${errorMessage(rmError)})`,
    );
    return { ok: false, error: `Could not clone ${cloneUrl}: ${errorMessage(error)}${cleanup}` };
  }
  return { ok: true, value: { root, dispose } };
}

export async function openGitClone(
  url: string,
  signal: AbortSignal,
  home = homedir(),
): Promise<Result<CodeSource>> {
  const parsed = parseGitHubUrl(url);
  if (!parsed.ok) return parsed;
  const cloned = await cloneRepository(parsed.value, signal);
  if (!cloned.ok) return cloned;
  const ownerAndRepo = new URL(parsed.value).pathname.slice(1, -".git".length);
  const tutorRoot = join(home, ".askmiyagi", ownerAndRepo.replace("/", "-"));
  try {
    await mkdir(tutorRoot, { recursive: true });
  } catch (error) {
    await cloned.value.dispose();
    return { ok: false, error: `Could not create ${tutorRoot}: ${errorMessage(error)}` };
  }
  return { ok: true, value: { ...cloned.value, tutorRoot } };
}
