import { parseArgs } from "node:util";
import { z } from "zod";
import { openLocalFolder } from "./source/local-folder.ts";
import { createSnapshot } from "./source/snapshot.ts";

const usage = "Usage: askmiyagi snapshot [path]";

const positionalsSchema = z.array(z.string().min(1)).max(1);

function parsePath(args: string[]) {
  try {
    const { positionals } = parseArgs({ args, options: {}, allowPositionals: true, strict: true });
    const parsed = positionalsSchema.safeParse(positionals);
    return parsed.success ? (parsed.data[0] ?? ".") : undefined;
  } catch {
    return undefined;
  }
}

function fail(message: string) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

export async function runSnapshotCommand(args: string[]) {
  const path = parsePath(args);
  if (path === undefined) return fail(usage);
  const source = await openLocalFolder(path);
  if (!source.ok) return fail(source.error);
  try {
    const snapshot = await createSnapshot(source.value.root);
    if (!snapshot.ok) return fail(snapshot.error);
    process.stdout.write(
      `Snapshot saved: ${snapshot.value} ${snapshot.value === 1 ? "file" : "files"}\n`,
    );
  } catch (error) {
    fail(`Could not save the snapshot: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await source.value.dispose();
  }
}
