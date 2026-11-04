import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import type { Profile } from "../../shared/profile.ts";
import { createProfileHandler } from "./profile-route.ts";

const servers: Server[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) server.close();
});

const profile: Profile = {
  level: "advanced",
  mode: "teach",
  frequency: "frequent",
  goal: "Prepare for an interview",
};

async function start() {
  const root = await tempDir();
  const handler = createProfileHandler(root);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/api/profile`;
  const put = (body: unknown) =>
    fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { root, get: () => fetch(url), put };
}

describe("createProfileHandler", () => {
  it("answers null until a profile is saved, then the saved profile", async () => {
    const { root, get, put } = await start();

    const before = await get();
    const saved = await put(profile);
    const after = await get();

    expect(before.status).toBe(200);
    expect(await before.json()).toBeNull();
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual(profile);
    expect(await after.json()).toEqual(profile);
    const file = join(root, ".tutor", "private", "profile.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(profile);
  });

  it("accepts a profile with no goal", async () => {
    const { put, get } = await start();

    await put({ ...profile, goal: null });

    expect(await (await get()).json()).toEqual({ ...profile, goal: null });
  });

  it.each([
    ["an unknown level", { ...profile, level: "expert" }],
    ["a missing field", { level: "advanced", mode: "teach", goal: null }],
    ["an empty goal", { ...profile, goal: "" }],
    ["a goal over 1000 characters", { ...profile, goal: "x".repeat(1001) }],
    ["no object", "advanced"],
  ])("refuses %s with 400 and saves nothing", async (_name, body) => {
    terminal();
    const { put, get } = await start();

    const response = await put(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(await (await get()).json()).toBeNull();
  });
});
