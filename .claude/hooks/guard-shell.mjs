import { block, readInput } from "./input.mjs";

const forbidden = [
  [/\bgit\b.*\bpush\b.*(\s--force(-with-lease)?\b|\s-f\b)/, "Force-pushing is not allowed."],
  [
    /\bgit\b.*\breset\b.*--hard\b/,
    "git reset --hard is not allowed. Keep the work and ask the user.",
  ],
  [/--no-verify\b/, "--no-verify is not allowed. Fix what the hooks report instead."],
  [/core\.hooksPath/i, "Changing core.hooksPath is not allowed."],
  [/co-authored-by/i, "Commit trailers are not allowed. Use a one-line message only."],
];

const input = await readInput();
const command = input.tool_input?.command ?? "";
for (const [pattern, message] of forbidden) {
  if (pattern.test(command)) block(`Blocked: ${message}`);
}
