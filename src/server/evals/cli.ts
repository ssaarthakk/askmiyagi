#!/usr/bin/env node
import { defaultResultsFolder, runEval } from "./eval-command.ts";

const interrupted = new AbortController();
process.on("SIGINT", () => interrupted.abort());
process.on("SIGTERM", () => interrupted.abort());

try {
  process.stdout.write(
    await runEval(process.argv.slice(2), defaultResultsFolder, interrupted.signal),
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
