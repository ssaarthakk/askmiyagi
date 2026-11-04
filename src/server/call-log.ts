import { appendFile, readFile, writeFile } from "node:fs/promises";
import { type CallRecord, callRecordSchema } from "../shared/call-log.ts";
import { parseContract } from "../shared/parse.ts";
import { writePrivateFile } from "./tutor-folder.ts";

let queue: Promise<void> = Promise.resolve();

function inOrder(write: () => Promise<void>) {
  const run = queue.then(write);
  queue = run;
  return run;
}

export function appendCallLog(root: string, record: CallRecord) {
  return inOrder(() =>
    writePrivateFile(root, "calls.jsonl", "Call not logged", (file) =>
      appendFile(file, `${JSON.stringify(record)}\n`),
    ),
  );
}

export function addFirstSound(root: string, ms: number) {
  return inOrder(() =>
    writePrivateFile(root, "calls.jsonl", "First sound not logged", async (file) => {
      const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
      const index = lines.findLastIndex((line) => JSON.parse(line).callType === "ask");
      const ask = parseContract(callRecordSchema, JSON.parse(lines[index] ?? "null"));
      if (!ask.ok) throw new Error(`there is no ask call to update (${ask.error})`);
      lines[index] = JSON.stringify({ ...ask.value, firstSoundMs: ms });
      await writeFile(file, `${lines.join("\n")}\n`);
    }),
  );
}
