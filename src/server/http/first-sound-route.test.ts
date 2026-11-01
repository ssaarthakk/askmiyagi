import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { createFirstSoundHandler } from "./first-sound-route.ts";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function postFirstSound(root: string, writeTutorFiles: boolean) {
  const handler = createFirstSoundHandler(root, writeTutorFiles);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}/api/first-sound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ms: 850 }),
  });
}

describe("createFirstSoundHandler", () => {
  it("writes nothing for a source that keeps no tutor files, such as a GitHub clone", async () => {
    const root = await tempDir();
    const log = join(root, ".tutor", "private", "calls.jsonl");
    await mkdir(join(root, ".tutor", "private"), { recursive: true });
    const line = `${JSON.stringify({ callType: "ask" })}\n`;
    await writeFile(log, line);

    const response = await postFirstSound(root, false);

    expect(response.status).toBe(204);
    expect(await readFile(log, "utf8")).toBe(line);
  });
});
