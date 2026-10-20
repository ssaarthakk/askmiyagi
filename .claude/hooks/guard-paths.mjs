import { basename } from "node:path";
import { block, readInput } from "./input.mjs";

const input = await readInput();
const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? "";
const name = basename(path).toLowerCase();

if (name.startsWith(".env") && name !== ".env.example") {
  block(`Blocked: ${name} may hold secrets. Never read or edit .env files.`);
}
if (name.includes("playbook")) {
  block(`Blocked: ${name} is a private playbook file. Never read or edit it.`);
}
