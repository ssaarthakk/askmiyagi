import { appendFile, readFile, writeFile } from "node:fs/promises";
import { type CallRecord, callRecordSchema } from "../shared/call-log.ts";
import { parseContract } from "../shared/parse.ts";
import { writePrivateFile } from "./tutor-folder.ts";

export function appendCallLog(root: string, record: CallRecord) {
  return writePrivateFile(root, "calls.jsonl", "Call not logged", (file) =>
    appendFile(file, `${JSON.stringify(record)}\n`),
  );
}

export function addFirstSound(root: string, ms: number) {
  return writePrivateFile(root, "calls.jsonl", "First sound not logged", async (file) => {
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    const last = parseContract(callRecordSchema, JSON.parse(lines.at(-1) ?? "null"));
    if (!last.ok) throw new Error(`the last line is not a call (${last.error})`);
    lines[lines.length - 1] = JSON.stringify({ ...last.value, firstSoundMs: ms });
    await writeFile(file, `${lines.join("\n")}\n`);
  });
}
