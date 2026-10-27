import type { Result } from "../../shared/result.ts";

const pathPattern = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function parseGitHubUrl(input: string): Result<string> {
  const refused: Result<string> = {
    ok: false,
    error: `Only https://github.com/<owner>/<repo> URLs can be cloned: ${input}`,
  };
  if (!/^https:\/\//i.test(input) || !URL.canParse(input)) return refused;
  const url = new URL(input);
  if (url.hostname !== "github.com" || url.port || url.username || url.password) return refused;
  if (url.search || url.hash) return refused;
  const match = pathPattern.exec(url.pathname);
  if (!match) return refused;
  return { ok: true, value: `https://github.com/${match[1]}/${match[2]}.git` };
}
