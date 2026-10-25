import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect, request } from "../../../test/fake-claude.ts";
import { runClaude } from "./claude-process.ts";
import { parseClaudeStream } from "./claude-stream.ts";

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
    expect(stepError).toMatchObject({ type: "error", retryable: false });
    if (stepError?.type === "error") {
      expect(stepError.message).toContain("title");
      expect(stepError.message).toContain("anchors");
    }
    expect(events[3]).toMatchObject({
      type: "error",
      message: expect.stringContaining("checkQuestion"),
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
