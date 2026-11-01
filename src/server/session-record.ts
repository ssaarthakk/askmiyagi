import { writeFile } from "node:fs/promises";
import { parseContract } from "../shared/parse.ts";
import { type SessionRecord, sessionSchema } from "../shared/session.ts";
import { writePrivateFile } from "./tutor-folder.ts";

export function writeSessionRecord(root: string, session: SessionRecord) {
  return writePrivateFile(root, "session.json", "Session not saved", async (file) => {
    const checked = parseContract(sessionSchema, session);
    if (!checked.ok) throw new Error(checked.error);
    await writeFile(file, JSON.stringify(checked.value, null, 2));
  });
}
