import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type WatchEvent, watchEventSchema } from "../src/shared/events.ts";
import { readEvents } from "../src/web/sse.ts";
import { requestPath, startServer } from "./cli-harness.ts";

const basic = "test/fixtures/basic";
const file = "src/clip-service.ts";
const recording = "test/fixtures/recordings/ask-tour.jsonl";

async function startTour() {
  const started = await startServer(basic, ["--provider", "fake", "--recording", recording]);
  const stop = new AbortController();
  const events = await fetch(new URL("/api/events", started.url), {
    headers: { "x-miyagi-token": started.token },
    signal: stop.signal,
  });
  expect(events.status).toBe(200);
  const asked = await fetch(new URL("/api/ask", started.url), {
    method: "POST",
    headers: { "x-miyagi-token": started.token, "content-type": "application/json" },
    body: JSON.stringify({ question: "How are clips saved?" }),
  });
  await asked.text();
  return { ...started, events, stop };
}

async function eventsUntil(
  response: Response,
  stop: AbortController,
  finished: (seen: WatchEvent[]) => boolean,
) {
  if (!response.body) throw new Error("No event stream");
  const seen: WatchEvent[] = [];
  await readEvents(response.body, watchEventSchema, (event) => {
    seen.push(event);
    if (finished(seen)) stop.abort();
  }).catch((error: unknown) => {
    if (!stop.signal.aborted) throw error;
  });
  return seen;
}

describe("GET /api/events", () => {
  it("requires the session token", async () => {
    const { url } = await startServer(basic);

    await expect(requestPath(url, "/api/events")).resolves.toMatchObject({ status: 401 });
  });

  it("sends the moved range when a file in the tour is edited mid-tour", async () => {
    const { folder, events, stop } = await startTour();
    const source = await readFile(join(folder, file), "utf8");

    await writeFile(join(folder, file), `export const header = 1;\n${source}`);
    const seen = await eventsUntil(events, stop, (all) => all.length > 0);

    expect(seen[0]).toEqual({
      type: "ranges",
      ranges: [
        [{ file, start: 3, end: 5, capped: false }],
        [{ file: "src/upload.ts", start: 1, end: 3, capped: false }, null],
      ],
    });
  });

  it("sends stale when the anchored code is removed mid-tour", async () => {
    const { folder, events, stop } = await startTour();

    await writeFile(join(folder, file), "export const other = 1;\n");
    const seen = await eventsUntil(events, stop, (all) =>
      all.some((event) => event.type === "stale"),
    );

    expect(seen).toContainEqual({ type: "stale", file });
  });
});
