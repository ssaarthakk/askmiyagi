import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { learnerSchema } from "../src/shared/learner.ts";
import { startServer } from "./cli-harness.ts";

const args = ["--provider", "fake", "--recording", "test/fixtures/recordings/concepts-tour.jsonl"];
const question = "How are clips saved?";

function post(url: string, token: string | undefined, path: string, body: unknown) {
  return fetch(new URL(path, url), {
    method: "POST",
    headers: { ...(token ? { "x-miyagi-token": token } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function learnerStates(folder: string) {
  const file = join(folder, ".tutor", "private", "learner.json");
  const { concepts } = learnerSchema.parse(JSON.parse(await readFile(file, "utf8")));
  return concepts.map(({ name, state }) => ({ name, state }));
}

function get(url: string, token: string | undefined, path: string) {
  return fetch(new URL(path, url), { headers: token ? { "x-miyagi-token": token } : {} });
}

describe("learner record", () => {
  it("marks a tour's concepts seen when it ends and explained when the browser reports it played", async () => {
    const { url, token, folder } = await startServer("test/fixtures/basic", args);

    await (await post(url, token, "/api/ask", { question })).text();
    await vi.waitFor(async () =>
      expect(await learnerStates(folder)).toEqual([
        { name: "Clip saving", state: "seen" },
        { name: "Async/Await", state: "seen" },
      ]),
    );

    expect((await post(url, token, "/api/played", { tour: question })).status).toBe(204);
    await vi.waitFor(async () =>
      expect(await learnerStates(folder)).toEqual([
        { name: "Clip saving", state: "explained" },
        { name: "Async/Await", state: "explained" },
      ]),
    );
  });

  it("needs the session token for /api/played", async () => {
    const { url } = await startServer("test/fixtures/basic", args);

    expect((await post(url, undefined, "/api/played", { tour: question })).status).toBe(401);
  });

  it("needs the session token for /api/skipped and /api/predict", async () => {
    const { url } = await startServer("test/fixtures/basic", args);

    expect((await post(url, undefined, "/api/skipped", { tour: question })).status).toBe(401);
    expect(
      (await post(url, undefined, "/api/predict", { tour: question, step: 0, prediction: "x" }))
        .status,
    ).toBe(401);
  });

  it("serves /api/skipped and /api/predict, refusing a bad body and a step with nothing to predict", async () => {
    const { url, token } = await startServer("test/fixtures/basic", args);

    expect((await post(url, token, "/api/skipped", { tour: question })).status).toBe(204);
    expect((await post(url, token, "/api/skipped", {})).status).toBe(400);
    expect((await post(url, token, "/api/predict", { tour: question })).status).toBe(400);
    const nothing = await post(url, token, "/api/predict", {
      tour: question,
      step: 0,
      prediction: "x",
    });
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toEqual({ error: "That step has nothing to predict" });
  });

  it("needs the session token for /api/explain-back, /api/reviews and /api/review-skipped", async () => {
    const { url } = await startServer("test/fixtures/basic", args);

    expect(
      (await post(url, undefined, "/api/explain-back", { concept: "Clip saving", answer: "x" }))
        .status,
    ).toBe(401);
    expect((await get(url, undefined, "/api/reviews")).status).toBe(401);
    expect(
      (await post(url, undefined, "/api/review-skipped", { concept: "Clip saving" })).status,
    ).toBe(401);
  });

  it("serves /api/explain-back, refusing a concept that is not in the record and a bad body", async () => {
    const { url, token } = await startServer("test/fixtures/basic", args);

    const unknown = await post(url, token, "/api/explain-back", {
      concept: "Nothing",
      answer: "x",
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "That concept is not in your learner record" });
    expect((await post(url, token, "/api/explain-back", { concept: "Nothing" })).status).toBe(400);
  });

  it("serves /api/reviews and /api/review-skipped", async () => {
    const { url, token } = await startServer("test/fixtures/basic", args);

    const due = await get(url, token, "/api/reviews");
    expect(due.status).toBe(200);
    expect(await due.json()).toEqual({ due: [] });
    expect((await post(url, token, "/api/review-skipped", { concept: "Clip saving" })).status).toBe(
      204,
    );
    expect((await post(url, token, "/api/review-skipped", {})).status).toBe(400);
  });
});
