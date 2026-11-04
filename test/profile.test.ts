import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "./cli-harness.ts";

const fixture = "test/fixtures/basic";
const profile = { level: "beginner", mode: "teach", frequency: "light", goal: "Learn the upload" };

function call(url: string, token: string | undefined, method: string, body?: unknown) {
  return fetch(new URL("/api/profile", url), {
    method,
    headers: { ...(token ? { "x-miyagi-token": token } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/profile", () => {
  it("needs the session token", async () => {
    const { url } = await startServer(fixture);

    expect((await call(url, undefined, "GET")).status).toBe(401);
    expect((await call(url, "wrong", "PUT", profile)).status).toBe(401);
  });

  it("starts with no profile, then saves one into .tutor/private of the project", async () => {
    const { url, token, folder } = await startServer(fixture);

    expect(await (await call(url, token, "GET")).json()).toBeNull();
    expect((await call(url, token, "PUT", profile)).status).toBe(200);

    expect(await (await call(url, token, "GET")).json()).toEqual(profile);
    const file = join(folder, ".tutor", "private", "profile.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(profile);
  });
});
