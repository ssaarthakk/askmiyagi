import { basename } from "node:path";
import { parseGitHubUrl } from "./github-url.ts";

export function projectName(path: string, root: string) {
  const cloneUrl = parseGitHubUrl(path);
  return cloneUrl.ok ? basename(cloneUrl.value, ".git") : basename(root) || root;
}
