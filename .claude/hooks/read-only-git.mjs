import { block, readInput } from "./input.mjs";

const allowed = /^git\s+(diff|status|log|show)(\s[^;&|`$<>]*)?$/;

const input = await readInput();
const command = (input.tool_input?.command ?? "").trim();
if (!allowed.test(command)) {
  block(
    "Blocked: reviewers may only run git diff, git status, git log or git show, with no chaining.",
  );
}
