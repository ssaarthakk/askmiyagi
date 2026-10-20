import { readFileSync } from "node:fs";
import { readInput } from "./input.mjs";

const limit = 300;
const source = /\.(ts|mts|js|mjs|svelte|css)$/;
const skipped = /(^|[/])(node_modules|dist|coverage|docs|evals[/]results)[/]|\.d\.ts$|lock/;

const input = await readInput();
const path = input.tool_input?.file_path ?? "";
if (source.test(path) && !skipped.test(path)) {
  const lines = readFileSync(path, "utf8").split("\n").length;
  if (lines > limit) {
    const reason = `${path} has ${lines} lines (limit ${limit}). Split it by responsibility, not by type.`;
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
  }
}
