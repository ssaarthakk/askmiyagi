import { appendFile } from "node:fs/promises";
import type { CallRecord } from "../shared/call-log.ts";
import { writePrivateFile } from "./tutor-folder.ts";

export function appendCallLog(root: string, record: CallRecord) {
  return writePrivateFile(root, "calls.jsonl", "Call not logged", (file) =>
    appendFile(file, `${JSON.stringify(record)}\n`),
  );
}
