import { spawnSync } from "node:child_process";
import { block, readInput } from "./input.mjs";

const input = await readInput();
if (!input.stop_hook_active) {
  const result = spawnSync("npm run check:fast", {
    cwd: process.env.CLAUDE_PROJECT_DIR,
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim().split("\n").slice(-40).join("\n");
    block(`npm run check:fast failed. Fix these before stopping:\n${output}`);
  }
}
