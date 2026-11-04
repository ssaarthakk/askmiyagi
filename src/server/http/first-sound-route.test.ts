import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import { createFirstSoundHandler } from "./first-sound-route.ts";

const record: CallRecord = {
  callType: "ask",
  provider: "fake",
  mode: "brute-force",
  startedAt: "2026-10-31T10:00:00.000Z",
  ackMs: 1,
  firstContentMs: 20,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 2,
  cacheWriteTokens: 3,
  costUsd: null,
  filesOpened: [],
  outcome: "done",
};

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function postFirstSound(tutorRoot: string) {
  const handler = createFirstSoundHandler(tutorRoot);
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
  it("adds the time to the last call in the tutor root's log", async () => {
    const tutorRoot = await tempDir();
    const log = join(tutorRoot, ".tutor", "private", "calls.jsonl");
    await mkdir(join(tutorRoot, ".tutor", "private"), { recursive: true });
    await writeFile(
      log,
      `${JSON.stringify(record)}
`,
    );

    const response = await postFirstSound(tutorRoot);

    expect(response.status).toBe(204);
    expect(JSON.parse(await readFile(log, "utf8"))).toEqual({ ...record, firstSoundMs: 850 });
  });
});
