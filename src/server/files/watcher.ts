import { watch } from "node:fs";
import { logError } from "../log.ts";

const debounceMs = 100;

export function watchFolder(root: string, onChange: (paths: string[]) => void) {
  const changed = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  try {
    const watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return;
      changed.add(name.replaceAll("\\", "/"));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...changed];
        changed.clear();
        onChange(paths);
      }, debounceMs);
    });
    watcher.on("error", (error) => logError(`File watching stopped: ${error.message}`));
    return {
      close() {
        clearTimeout(timer);
        watcher.close();
      },
    };
  } catch (error) {
    logError(`Could not watch for code changes: ${error instanceof Error ? error.message : error}`);
    return { close() {} };
  }
}
