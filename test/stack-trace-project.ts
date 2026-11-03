import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { anchorStackTrace, parseStackTrace } from "../src/server/llm/stack-trace.ts";
import { tempDir } from "./temp-dir.ts";

export const users = `export function getUser(id: string) {
  const user = users.get(id);
  return user.id;
}

export class Account {
  constructor(public name: string) {
    this.name = name;
  }
  close() {
    return this.name;
  }
}

export const handler = async () => {
  return getUser("a");
};
`;

export const sourceMap = JSON.stringify({
  version: 3,
  file: "index.js",
  sources: ["../src/users.ts"],
  sourcesContent: ["TOPSECRET"],
  names: [],
  mappings: "4BAEI",
});

export const generated =
  "function getUser(id){return users.get(id).id}\n//# sourceMappingURL=index.js.map\n";

export async function createFiles(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

export async function createProject(files: Record<string, string> = {}) {
  const root = join(await tempDir(), "repo");
  await createFiles(root, {
    "src/users.ts": users,
    "dist/index.js": generated,
    "dist/index.js.map": sourceMap,
    ...files,
  });
  return root;
}

export async function anchor(root: string, ...frames: string[]) {
  const trace = parseStackTrace(
    `Error: boom\n${frames.map((frame) => `  at ${frame}`).join("\n")}`,
  );
  if (!trace) throw new Error("not a trace");
  return anchorStackTrace(root, trace);
}
