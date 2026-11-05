import { sameConcept } from "../../shared/learner.ts";
import { type LearningPath, type PathReply, pathSchema } from "../../shared/path.ts";
import { readPrivateJson, writePrivateJson } from "../tutor-folder.ts";

const pathFile = "path.json";

export async function readPath(root: string) {
  const read = await readPrivateJson(root, pathFile, pathSchema);
  return read.ok ? read.value : null;
}

export function writePath(root: string, path: LearningPath) {
  return writePrivateJson(root, pathFile, path);
}

export function withProgress(path: LearningPath | null, explained: string[]): PathReply {
  if (!path) return null;
  return {
    items: path.items.map((item) => ({
      ...item,
      done: explained.some((name) => sameConcept(name, item.concept)),
    })),
  };
}
