import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default function setup() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm must run Vitest so the build can run before tests");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  execFileSync(process.execPath, [npmCli, "run", "build"], { cwd: root, stdio: "inherit" });
}
