import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach } from "vitest";
import { createFiles } from "./stack-trace-project.ts";
import { tempDir } from "./temp-dir.ts";

export const pathProject: Record<string, string> = {
  "src/main.ts": 'import { serve } from "./server.ts";\nserve();',
  "src/server.ts": 'import { read } from "./store.ts";\nexport const serve = read;',
  "src/store.ts": "export const read = 1;",
  "src/clip.ts": 'import { read } from "./store.ts";\nexport const clip = read;',
  "src/orphan.ts": "export const orphan = 1;",
};

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

export async function writePathProject() {
  const root = await tempDir();
  await createFiles(root, pathProject);
  return root;
}

export async function listen(handle: RequestListener) {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
