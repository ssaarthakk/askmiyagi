import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect } from "../../../test/fake-claude.ts";
import type { Selection } from "../../shared/anchor.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

const root = resolve(import.meta.dirname, "../../../test/fixtures/basic");

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

describe("askEvents with a selection", () => {
  async function askWith(selection: Selection) {
    const seen: LLMRequest[] = [];
    const events = await collect(
      askEvents({
        root,
        provider: {
          async *ask(request) {
            seen.push(request);
            yield { type: "done", usage };
          },
        },
        question: "What is this?",
        ack: "One moment.",
        signal: new AbortController().signal,
        selection,
        conversation: createConversation(),
      }),
    );
    return { seen, events };
  }

  it("puts a selection whose lines contain its text into the request as untrusted content", async () => {
    const { seen, events } = await askWith({
      file: "src/upload.ts",
      start: 1,
      end: 1,
      text: "uploadClip",
    });
    expect(seen[0]?.question).toContain("What is this?");
    expect(seen[0]?.question).toContain("src/upload.ts");
    expect(seen[0]?.question).toMatch(/<untrusted_content[^>]*>uploadClip<\/untrusted_content>/);
    expect(events.filter((event) => event.type === "progress")).toEqual([]);
  });

  it("keeps a whole-line selection that ends with the line break", async () => {
    const { seen, events } = await askWith({
      file: "src/upload.ts",
      start: 1,
      end: 1,
      text: "export async function uploadClip(path: string) {\n",
    });
    expect(seen[0]?.question).toContain("src/upload.ts");
    expect(events.filter((event) => event.type === "progress")).toEqual([]);
  });

  it.each([
    [
      "the text is not in those lines",
      { file: "src/upload.ts", start: 2, end: 2, text: "uploadClip" },
    ],
    [
      "the lines are past the end of the file",
      { file: "src/upload.ts", start: 9, end: 9, text: "x" },
    ],
    [
      "the end is before the start",
      { file: "src/upload.ts", start: 3, end: 1, text: "uploadClip" },
    ],
    ["the file does not exist", { file: "src/nope.ts", start: 1, end: 1, text: "x" }],
    ["the path escapes the project", { file: "../outside.ts", start: 1, end: 1, text: "x" }],
  ])("drops the selection and says so when %s", async (_reason, selection) => {
    const { seen, events } = await askWith(selection);
    expect(seen[0]?.question).toBe("What is this?");
    expect(events.filter((event) => event.type === "progress")).toEqual([
      { type: "progress", text: expect.stringContaining("selection") },
    ]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
