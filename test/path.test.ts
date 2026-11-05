import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { learnerSchema } from "../src/shared/learner.ts";
import { startServer } from "./cli-harness.ts";

const fixture = "test/fixtures/basic";
const args = ["--provider", "fake", "--recording", "test/fixtures/recordings/path-plan.jsonl"];
const profile = { level: "beginner", mode: "teach", frequency: "light", goal: "Add retries" };

function call(
  url: string,
  token: string | undefined,
  path: string,
  method: string,
  body?: unknown,
) {
  return fetch(new URL(path, url), {
    method,
    headers: { ...(token ? { "x-miyagi-token": token } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function explained(folder: string, name: string) {
  const learner = learnerSchema.parse({
    concepts: [
      {
        name,
        kind: "repo",
        important: true,
        state: "explained",
        rubric: null,
        attempts: 0,
        reviewsDone: 0,
        nextReview: null,
      },
    ],
  });
  const privateFolder = join(folder, ".tutor", "private");
  await mkdir(privateFolder, { recursive: true });
  await writeFile(join(privateFolder, "learner.json"), JSON.stringify(learner));
}

describe("/api/path", () => {
  it("needs the session token", async () => {
    const { url } = await startServer(fixture, args);

    expect((await call(url, undefined, "/api/path", "GET")).status).toBe(401);
    expect((await call(url, "wrong", "/api/path", "POST", {})).status).toBe(401);
  });

  it("starts with no path, plans one from the goal over visible files, and ticks explained concepts", async () => {
    const { url, token, folder } = await startServer(fixture, args);

    expect(await (await call(url, token, "/api/path", "GET")).json()).toBeNull();
    expect((await call(url, token, "/api/profile", "PUT", profile)).status).toBe(200);
    await explained(folder, "clip saving");

    const planned = await call(url, token, "/api/path", "POST", {});
    expect(planned.status).toBe(200);

    const expected = [
      { concept: "Project overview", file: "README.md", done: false },
      { concept: "Scripts", file: "package.json", done: false },
      { concept: "Clip saving", file: "src/clip-service.ts", done: true },
      { concept: "Uploads", file: "src/upload.ts", done: false },
      { concept: "Notes", file: "notes.md", done: false },
    ];
    expect(await planned.json()).toMatchObject({ items: expected });
    expect(await (await call(url, token, "/api/path", "GET")).json()).toMatchObject({
      items: expected,
    });
  });
});
