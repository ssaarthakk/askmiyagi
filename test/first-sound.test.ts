import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "./cli-harness.ts";

const fixture = "test/fixtures/basic";
const fakeAsk = ["--provider", "fake", "--recording", "test/fixtures/recordings/ask-tour.jsonl"];

function post(url: string, path: string, token: string, body: unknown) {
  return fetch(new URL(path, url), {
    method: "POST",
    headers: { "x-miyagi-token": token, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loggedCalls(folder: string) {
  const text = await readFile(join(folder, ".tutor", "private", "calls.jsonl"), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("POST /api/first-sound", () => {
  it("adds the time to the last call's log line", async () => {
    const { url, token, folder } = await startServer(fixture, fakeAsk);
    await (await post(url, "/api/ask", token, { question: "How are clips saved?" })).text();

    const response = await post(url, "/api/first-sound", token, { ms: 850 });

    expect(response.status).toBe(204);
    expect(await loggedCalls(folder)).toEqual([
      expect.objectContaining({ callType: "ask", firstSoundMs: 850 }),
    ]);
  });

  it.each([{ ms: -1 }, { ms: "850" }, {}])("refuses the body %j", async (body) => {
    const { url, token, folder } = await startServer(fixture, fakeAsk);
    await (await post(url, "/api/ask", token, { question: "How are clips saved?" })).text();

    const response = await post(url, "/api/first-sound", token, body);

    expect(response.status).toBe(400);
    expect((await loggedCalls(folder))[0]).not.toHaveProperty("firstSoundMs");
  });
});
