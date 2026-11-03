import type { Result } from "./result.ts";

type GitArgs = {
  flags: string[];
  count: number | undefined;
  revisions: string[];
  paths: string[];
};

const outputFlags = new Set(["--stat", "--name-only", "--name-status", "--oneline", "--no-color"]);
const contextFlag = /^-U\d{1,4}$/;
const revision = /^[A-Za-z0-9_@~^][A-Za-z0-9_./@~^{}-]*$/;
const unpeelableRevision = /\^[{@!-]/;
const rangeSeparator = /(\.\.\.?)/;
const maximumCount = 200;

function isUnsafePath(path: string) {
  return (
    !path ||
    path.startsWith(":") ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-z]:/i.test(path) ||
    path.split(/[/\\]/).includes("..")
  );
}

function asCommits(argument: string) {
  return argument
    .split(rangeSeparator)
    .map((part, index) => (index % 2 === 1 || part === "" ? part : `${part}^{commit}`))
    .join("");
}

export function parseGitArgs(args: string[]): Result<GitArgs> {
  const separator = args.indexOf("--");
  const options = separator === -1 ? args : args.slice(0, separator);
  const paths = separator === -1 ? [] : args.slice(separator + 1);
  const parsed: GitArgs = { flags: [], count: undefined, revisions: [], paths };

  for (let index = 0; index < options.length; index += 1) {
    const argument = options[index] ?? "";
    if (argument === "-n") {
      const count = Number(options[index + 1]);
      if (!Number.isInteger(count) || count < 1 || count > maximumCount) {
        return { ok: false, error: `-n needs a count from 1 to ${maximumCount}` };
      }
      parsed.count = count;
      index += 1;
    } else if (outputFlags.has(argument) || contextFlag.test(argument)) {
      parsed.flags.push(argument);
    } else if (argument.startsWith("-")) {
      return { ok: false, error: `Flag not allowed: ${argument}` };
    } else if (revision.test(argument) && !unpeelableRevision.test(argument)) {
      parsed.revisions.push(asCommits(argument));
    } else {
      return { ok: false, error: `Not a revision: ${argument}` };
    }
  }

  const unsafePath = paths.find(isUnsafePath);
  if (unsafePath !== undefined) {
    return { ok: false, error: `Path not allowed: ${unsafePath || "(empty)"}` };
  }
  return { ok: true, value: parsed };
}
