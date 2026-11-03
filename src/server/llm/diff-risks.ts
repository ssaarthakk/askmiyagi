import { resolveRelativeImports } from "../code/repo-map.ts";
import { readRedactedFile } from "../files/path-guard.ts";

type ChangedFile = { path: string; added: string[]; removed: string[] };

const maximumLineCharacters = 120;
const fileHeader = /^diff --git a\/(.+) b\/\1$/;
const comment = /^(?:\/\/|#|\/?\*)/;
const exiting = /\b(?:return|throw|raise|continue|break)\b/;
const throwing = /\b(?:throw|raise)\b/;
const guarding = /^(?:else\s+)?(?:if|elif|unless)\b/;
const handling = /^\}?\s*(?:try|catch|finally|except|rescue)\b/;
const testing = /^(?:(?:it|test|describe)(?:\.\w+)?\(|(?:async\s+)?def test_|func Test)/;
const testPath = /[._](?:test|spec)\.\w+$|(?:^|\/)(?:tests?|__tests__)\/|(?:^|\/)test_[^/]*$/;

function parseDiff(diff: string) {
  const files: ChangedFile[] = [];
  let file: ChangedFile | undefined;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const header = fileHeader.exec(line);
    if (header) {
      file = { path: header[1] ?? "", added: [], removed: [] };
      files.push(file);
      inHunk = false;
    } else if (!file) {
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (inHunk && line.startsWith("+")) {
      file.added.push(line.slice(1));
    } else if (inHunk && line.startsWith("-")) {
      file.removed.push(line.slice(1));
    }
  }
  return files;
}

function changedLines(lines: string[], otherSide: string[]) {
  const unchanged = new Set(otherSide.map((line) => line.trim()));
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== "" && !comment.test(line) && !unchanged.has(line));
}

function removedKind(line: string, next: string) {
  if (testing.test(line)) return "a test";
  if (guarding.test(line) && (exiting.test(line) || exiting.test(next))) return "a guard";
  if (throwing.test(line)) return "a throw";
  if (handling.test(line)) return "error handling";
  return undefined;
}

function shortened(line: string) {
  return line.slice(0, maximumLineCharacters);
}

export function findRisks(diff: string) {
  return parseDiff(diff).flatMap(({ path, added, removed }) => {
    const gone = changedLines(removed, added);
    const came = changedLines(added, removed);
    return [
      ...gone.flatMap((line, index) => {
        const kind = removedKind(line, gone[index + 1] ?? "");
        return kind ? [`${path}: removed ${kind}: ${shortened(line)}`] : [];
      }),
      ...came
        .filter((line) => handling.test(line))
        .map((line) => `${path}: added error handling: ${shortened(line)}`),
    ];
  });
}

export async function findCoveringTests(root: string, diff: string) {
  const files = parseDiff(diff);
  const sources = new Set(files.filter(({ path }) => !testPath.test(path)).map(({ path }) => path));
  const covering: string[] = [];
  for (const { path } of files) {
    if (!testPath.test(path)) continue;
    const test = await readRedactedFile(root, path);
    if (!test.ok) continue;
    for (const covered of await resolveRelativeImports(path, test.value.source, sources)) {
      covering.push(`${path} covers ${covered}`);
    }
  }
  return covering;
}
