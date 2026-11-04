import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect, request } from "../../../test/fake-claude.ts";
import { runClaude } from "./claude-process.ts";
import { modelLineEvents, parseClaudeStream } from "./claude-stream.ts";
import { lostThread } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const recordings = resolve(import.meta.dirname, "../../../test/fixtures/recordings");

async function* linesOf(lines: string[]) {
  for (const line of lines) yield line;
}

async function parseRecording(name: string) {
  const text = await readFile(resolve(recordings, name), "utf8");
  return collect(parseClaudeStream(linesOf(text.split("\n").filter((line) => line !== ""))));
}

function delta(text: string) {
  return JSON.stringify({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: null,
  });
}

const result = JSON.stringify({ type: "result", is_error: false, result: "", usage: {} });

describe("parseClaudeStream", () => {
  it("turns a recorded run into tool calls, steps, a check question and done with usage", async () => {
    const events = await parseRecording("claude-stream-tour.jsonl");
    expect(events).toEqual([
      { type: "tool_call", name: "read_file", input: { path: "src/clip-service.ts" } },
      {
        type: "step",
        step: {
          title: "Saving a clip",
          anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
          narration: [{ text: "Clips are saved here.", anchor: 0 }],
        },
      },
      { type: "checkQuestion", text: "What does save return?" },
      {
        type: "done",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 100,
          cacheWriteTokens: 20,
          costUsd: 0.05,
        },
      },
    ]);
  });

  it("passes non-JSON lines on as text, reports bad lines as errors and keeps parsing", async () => {
    const events = await parseRecording("claude-stream-bad-output.jsonl");
    expect(events.map((event) => event.type)).toEqual([
      "text",
      "error",
      "error",
      "error",
      "step",
      "done",
    ]);
    expect(events[0]).toEqual({ type: "text", text: "Here is the tour:" });
    const stepError = events[1];
    expect(stepError).toMatchObject({
      type: "error",
      message: lostThread,
      retryable: false,
      invalidStep: true,
    });
    if (stepError?.type === "error") {
      expect(stepError.detail).toContain("title");
      expect(stepError.detail).toContain("anchors");
    }
    expect(events[3]).toMatchObject({
      type: "error",
      message: lostThread,
      detail: expect.stringContaining("checkQuestion"),
    });
    expect(events[3]).toMatchObject({ invalidStep: undefined });
  });

  it("keeps a step with one bad anchor, dropping the anchor and repointing the narration", async () => {
    const step = {
      title: "Saving a clip",
      anchors: [
        { file: "src/clip-service.ts", symbol: "ClipService" },
        { file: "src/upload.ts", line: 3, text: "" },
        { file: "src/upload.ts", symbol: "uploadClip" },
      ],
      narration: [
        { text: "One.", anchor: 0 },
        { text: "Two.", anchor: 1 },
        { text: "Three.", anchor: 2 },
      ],
    };
    const events = await collect(
      parseClaudeStream(
        linesOf([
          delta(`${JSON.stringify(step)}
`),
          result,
        ]),
      ),
    );
    expect(events[0]).toEqual({
      type: "step",
      step: {
        title: "Saving a clip",
        anchors: [
          { file: "src/clip-service.ts", symbol: "ClipService" },
          { file: "src/upload.ts", symbol: "uploadClip" },
        ],
        narration: [{ text: "One.", anchor: 0 }, { text: "Two." }, { text: "Three.", anchor: 1 }],
      },
    });
  });

  it("reports a null cost when the result has none", async () => {
    const events = await parseRecording("claude-stream-bad-output.jsonl");
    expect(events.at(-1)).toEqual({
      type: "done",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: null,
      },
    });
  });

  it("emits a step as soon as its line is complete, before later output is read", async () => {
    const step =
      '{"title":"T","anchors":[{"file":"a.ts","symbol":"a"}],"narration":[{"text":"hi"}]}';
    let readLater = false;
    async function* lines() {
      yield delta(`${step}\n`);
      readLater = true;
      yield result;
    }
    const first = await parseClaudeStream(lines()).next();
    expect(first.value).toMatchObject({ type: "step" });
    expect(readLater).toBe(false);
  });

  it("joins a line split across deltas and flushes a last line without a newline", async () => {
    const events = await collect(
      parseClaudeStream(linesOf([delta("not "), delta("json"), result])),
    );
    expect(events[0]).toEqual({ type: "text", text: "not json" });
  });

  it("turns a failed run into a non-retryable error", async () => {
    const failed = JSON.stringify({
      type: "result",
      is_error: true,
      result: "Credit balance is too low",
    });
    const events = await collect(parseClaudeStream(linesOf([failed])));
    expect(events).toEqual([
      {
        type: "error",
        message: "Claude Code reported an error: Credit balance is too low",
        retryable: false,
      },
    ]);
  });

  it("says clearly that Claude Code is logged out, from a recorded run", async () => {
    const events = await parseRecording("claude-stream-logged-out.jsonl");
    expect(events).toEqual([
      {
        type: "error",
        message: "Claude Code is not logged in. Run `claude` and use /login, then ask again.",
        retryable: false,
      },
    ]);
  });

  it("turns a scope line into a scope event and rejects any other scope", () => {
    expect([...modelLineEvents('{"scope":"side"}')]).toEqual([{ type: "scope", scope: "side" }]);
    expect([...modelLineEvents('{"scope":"new"}')]).toEqual([{ type: "scope", scope: "new" }]);
    expect([...modelLineEvents('{"scope":"later"}')]).toEqual([
      expect.objectContaining({ type: "error", message: lostThread, retryable: false }),
    ]);
  });

  it("turns an intent line into an intent event and drops any other intent", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect([...modelLineEvents('{"intent":"debugging"}')]).toEqual([
      { type: "intent", intent: "debugging" },
    ]);
    expect([...modelLineEvents('{"intent":"curiosity"}')]).toEqual([]);
    expect([...modelLineEvents('{"scope":"side","intent":"interview prep"}')]).toEqual([
      { type: "scope", scope: "side" },
    ]);
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  it("reads the scope and the intent from one final line", () => {
    expect([...modelLineEvents('{"scope":"side","intent":"contributing"}')]).toEqual([
      { type: "scope", scope: "side" },
      { type: "intent", intent: "contributing" },
    ]);
  });

  it("keeps a step that also carries an intent or a scope", () => {
    const step = {
      title: "Saving a clip",
      anchors: [{ file: "src/clip-service.ts", symbol: "ClipService" }],
      narration: [{ text: "It saves the clip.", anchor: 0 }],
    };
    expect([...modelLineEvents(JSON.stringify({ ...step, intent: "debugging" }))]).toEqual([
      { type: "step", step },
    ]);
    expect([...modelLineEvents(JSON.stringify({ ...step, scope: "side" }))]).toEqual([
      { type: "step", step },
    ]);
  });

  it("reports an unreadable stdout line as an error", async () => {
    const events = await collect(parseClaudeStream(linesOf(["garbage", result])));
    expect(events[0]).toMatchObject({ type: "error", retryable: false });
    expect(events[1]?.type).toBe("done");
  });

  it.skipIf(process.env.MIYAGI_LIVE !== "1")(
    "live: a real Claude Code run ends with done",
    async () => {
      const stream = runClaude({ ...request, tools: false }, new AbortController().signal);
      const events = await collect(parseClaudeStream(stream));
      expect(events.at(-1)?.type).toBe("done");
    },
    180_000,
  );
});

describe("check question line", () => {
  it("carries the concept the question is about", () => {
    const line = JSON.stringify({ checkQuestion: "Why?", checkConcept: "upload retries" });

    expect([...modelLineEvents(line)]).toEqual([
      { type: "checkQuestion", text: "Why?", concept: "upload retries" },
    ]);
    expect([...modelLineEvents(JSON.stringify({ checkQuestion: "Why?" }))]).toEqual([
      { type: "checkQuestion", text: "Why?" },
    ]);
  });
});

describe("concepts on the final line", () => {
  const retries = { name: "upload retries", important: true, kind: "repo" };

  it("turns a concepts list into a concepts event, next to scope and intent", () => {
    const line = JSON.stringify({ scope: "side", intent: "debugging", concepts: [retries] });

    expect([...modelLineEvents(line)]).toEqual([
      { type: "scope", scope: "side" },
      { type: "intent", intent: "debugging" },
      { type: "concepts", concepts: [retries] },
    ]);
    expect([...modelLineEvents(JSON.stringify({ concepts: [retries] }))]).toEqual([
      { type: "concepts", concepts: [retries] },
    ]);
  });

  it("accepts a language concept from the fixed list, ignoring case", () => {
    const concept = { name: "Async/Await", important: true, kind: "language" };

    expect([...modelLineEvents(JSON.stringify({ concepts: [concept] }))]).toEqual([
      { type: "concepts", concepts: [concept] },
    ]);
  });

  it("drops concepts that are malformed or name a language concept outside the list, and keeps the rest of the line", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const outside = { name: "monads", important: true, kind: "language" };

    expect([
      ...modelLineEvents(JSON.stringify({ intent: "debugging", concepts: [outside] })),
    ]).toEqual([{ type: "intent", intent: "debugging" }]);
    expect([...modelLineEvents('{"concepts":"retries"}')]).toEqual([]);
    expect(stderr).toHaveBeenCalledTimes(2);
  });

  it("keeps the valid concepts when one in the list is bad", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const outside = { name: "callbacks", important: false, kind: "language" };

    expect([...modelLineEvents(JSON.stringify({ concepts: [retries, outside] }))]).toEqual([
      { type: "concepts", concepts: [retries] },
    ]);
  });

  it("keeps at most 5 concepts", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...retries,
      name: `concept ${index}`,
    }));

    expect([...modelLineEvents(JSON.stringify({ concepts: many }))]).toEqual([
      { type: "concepts", concepts: many.slice(0, 5) },
    ]);
  });
});

describe("primm on a step line", () => {
  const step = {
    title: "Saving",
    anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
    narration: [{ text: "Clips are saved here." }],
  };
  const primm = {
    predict: "What does save return?",
    investigate: "Click the line that saves the clip.",
    target: { file: "src/clip-service.ts", line: 5, text: "await store.put(clip);" },
  };

  it("passes a valid primm on with the step", () => {
    expect([...modelLineEvents(JSON.stringify({ ...step, primm }))]).toEqual([
      { type: "step", step: { ...step, primm } },
    ]);
  });

  it("drops a primm that is not valid and keeps the step", () => {
    const silence = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const broken = { ...primm, target: { file: "src/clip-service.ts" } };

    expect([...modelLineEvents(JSON.stringify({ ...step, primm: broken }))]).toEqual([
      { type: "step", step },
    ]);
    expect(silence.mock.calls.join("")).toContain("Primm dropped");
    silence.mockRestore();
  });
});
