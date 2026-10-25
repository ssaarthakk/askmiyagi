import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect, request } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import { loadFakeProvider } from "./fake-provider.ts";

const recordings = resolve(import.meta.dirname, "../../../test/fixtures/recordings");

async function load(name: string) {
  const loaded = await loadFakeProvider(resolve(recordings, name));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

describe("FakeProvider", () => {
  it("replays the recorded events in order", async () => {
    const provider = await load("tour.jsonl");
    const events = await collect(provider.ask(request, new AbortController().signal));
    expect(events.map((event) => event.type)).toEqual(["text", "step", "done"]);
    expect(events[1]).toMatchObject({ type: "step", step: { title: "Saving a clip" } });
  });

  it("replays the same events on every ask", async () => {
    const provider = await load("tour.jsonl");
    const first = await collect(provider.ask(request, new AbortController().signal));
    const second = await collect(provider.ask(request, new AbortController().signal));
    expect(second).toEqual(first);
  });

  it("ends the stream promptly when aborted during a delay", async () => {
    const provider = await load("slow.jsonl");
    const controller = new AbortController();
    const started = Date.now();
    const events: ProviderEvent[] = [];
    for await (const event of provider.ask(request, controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events).toEqual([{ type: "text", text: "first" }]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("yields nothing when the signal is already aborted", async () => {
    const provider = await load("tour.jsonl");
    const events = await collect(provider.ask(request, AbortSignal.abort()));
    expect(events).toEqual([]);
  });

  it("waits for the recorded delay before an event", async () => {
    const provider = await load("slow.jsonl");
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 300);
    const events = await collect(provider.ask(request, controller.signal));
    expect(events).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });
});

describe("loadFakeProvider", () => {
  it("reports a missing recording", async () => {
    const file = resolve(recordings, "missing.jsonl");
    const loaded = await loadFakeProvider(file);
    expect(loaded).toEqual({ ok: false, error: `Recording not found: ${file}` });
  });

  it("names the line of an event that fails its schema", async () => {
    const loaded = await loadFakeProvider(resolve(recordings, "invalid.jsonl"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error).toContain("line 2");
      expect(loaded.error).toContain("anchors");
    }
  });

  it("names the line that is not JSON", async () => {
    const loaded = await loadFakeProvider(resolve(recordings, "not-json.jsonl"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toContain("line 2");
  });

  it("names every line whose delayMs is negative, fractional or not a number", async () => {
    const loaded = await loadFakeProvider(resolve(recordings, "bad-delay.jsonl"));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      for (const line of [1, 2, 3]) expect(loaded.error).toContain(`line ${line}:`);
      expect(loaded.error).toContain("delayMs");
    }
  });
});
