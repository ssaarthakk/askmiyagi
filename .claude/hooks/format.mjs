import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readInput } from "./input.mjs";

const input = await readInput();
const path = input.tool_input?.file_path;
if (path) {
  const biome = join(
    process.env.CLAUDE_PROJECT_DIR ?? ".",
    "node_modules/@biomejs/biome/bin/biome",
  );
  try {
    execFileSync(process.execPath, [biome, "format", "--write", "--no-errors-on-unmatched", path], {
      stdio: "ignore",
    });
  } catch {
    process.stderr.write(`Could not format ${path}; run npm run format to see why.\n`);
  }
}
