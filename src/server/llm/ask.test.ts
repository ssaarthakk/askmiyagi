import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collect } from "../../../test/fake-claude.ts";
import type { Selection } from "../../shared/anchor.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Step } from "../../shared/tour.ts";
import { askEvents } from "./ask.ts";
import type { LLMProvider } from "./provider.ts";

const root = resolve(import.meta.dirname, "../../../test/fixtures/basic");

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

const saveStep: Step = {
  title: "Saving a clip",
  anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
  narration: [{ text: "Clips are saved here.", anchor: 0 }],
};

const uploadStep: Step = {
  title: "Uploading",
  anchors: [
    { file: "src/upload.ts", symbol: "uploadClip" },
    { file: "src/missing.ts", symbol: "nothing" },
  ],
  narration: [{ text: "Then the clip is uploaded." }],
};

function scripted(events: ProviderEvent[], seen: LLMRequest[] = []): LLMProvider {
  return {
    async *ask(request) {
      seen.push(request);
      yield* events;
    },
  };
}

function stream(provider: LLMProvider, signal = new AbortController().signal) {
  return askEvents({
    root,
    provider,
    question: "How are clips saved?",
    ack: "One moment.",
    signal,
  });
}

describe("askEvents", () => {
  it("sends the acknowledgement before the provider is asked", async () => {
    const seen: LLMRequest[] = [];
    const events = stream(scripted([{ type: "done", usage }], seen));
    expect((await events.next()).value).toEqual({ type: "ack", text: "One moment." });
    expect(seen).toEqual([]);
    await events.return(undefined);
  });

  it("turns tool calls into progress lines", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "tool_call", name: "read_file", input: { path: "src/clip-service.ts" } },
          { type: "tool_call", name: "grep", input: { patterns: ["upload", "post", "publish"] } },
          { type: "tool_call", name: "find_symbol", input: { name: "ClipService.save" } },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.filter((event) => event.type === "progress")).toEqual([
      { type: "progress", text: "Looking at clip-service.ts" },
      { type: "progress", text: "Searching for upload or post or publish" },
      { type: "progress", text: "Finding ClipService.save" },
    ]);
  });

  it("sends each step with its resolved ranges, then the tour, then done", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "step", step: uploadStep },
          { type: "checkQuestion", text: "What does save return?" },
          { type: "done", usage },
        ]),
      ),
    );
    const saveRanges = [{ file: "src/clip-service.ts", start: 2, end: 4, capped: false }];
    const uploadRanges = [{ file: "src/upload.ts", start: 1, end: 3, capped: false }, null];
    expect(events).toEqual([
      { type: "ack", text: "One moment." },
      { type: "step", step: saveStep, ranges: saveRanges },
      { type: "step", step: uploadStep, ranges: uploadRanges },
      {
        type: "tour",
        tour: {
          question: "How are clips saved?",
          steps: [saveStep, uploadStep],
          checkQuestion: "What does save return?",
        },
        ranges: [saveRanges, uploadRanges],
      },
      { type: "done" },
    ]);
  });

  it("leaves the check question out of the tour when the model gave none", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "done", usage },
        ]),
      ),
    );
    const tour = events.find((event) => event.type === "tour");
    expect(tour?.tour).toEqual({ question: "How are clips saved?", steps: [saveStep] });
  });

  it("ends the ask with an error after an invalid step, keeping the steps already sent", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "error", message: "title: must not be empty", retryable: false },
          { type: "step", step: uploadStep },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "error"]);
    expect(events.at(-1)).toEqual({ type: "error", message: "title: must not be empty" });
  });

  it("ends the ask with an error that shows the line when it was not valid JSON", async () => {
    const events = await collect(
      stream(
        scripted([
          { type: "step", step: saveStep },
          { type: "text", text: "Sure! Here is the tour" },
          { type: "done", usage },
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "error"]);
    expect(JSON.stringify(events.at(-1))).toContain("Sure! Here is the tour");
  });

  it("turns a thrown provider failure into an error event", async () => {
    const failing: LLMProvider = {
      async *ask() {
        yield* [];
        throw new Error("Claude Code was not found.");
      },
    };
    expect(await collect(stream(failing))).toEqual([
      { type: "ack", text: "One moment." },
      { type: "error", message: "Claude Code was not found." },
    ]);
  });

  it("builds the request from the question", async () => {
    const requests: LLMRequest[] = [];
    await collect(stream(scripted([{ type: "done", usage }], requests)));
    expect(requests[0]?.question).toBe("How are clips saved?");
  });

  it("redacts a secret in the question before it reaches the provider, keeping it in the tour", async () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const question = `Why does ${key} fail?`;
    const seen: LLMRequest[] = [];
    const events = await collect(
      askEvents({
        root,
        provider: scripted([{ type: "done", usage }], seen),
        question,
        ack: "One moment.",
        signal: new AbortController().signal,
      }),
    );
    expect(JSON.stringify(seen)).not.toContain("sk-ant-");
    expect(seen[0]?.question).toBe("Why does [REDACTED] fail?");
    const tour = events.find((event) => event.type === "tour");
    expect(tour?.tour.question).toBe(question);
  });

  it("stops without a tour or done when the signal is aborted", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
        yield { type: "step", step: uploadStep };
        yield { type: "done", usage };
      },
    };
    const events = await collect(stream(provider, controller.signal));
    expect(events.map((event) => event.type)).toEqual(["ack", "step"]);
  });
});

describe("askEvents with a selection", () => {
  async function askWith(selection: Selection) {
    const seen: LLMRequest[] = [];
    const events = await collect(
      askEvents({
        root,
        provider: scripted([{ type: "done", usage }], seen),
        question: "What is this?",
        ack: "One moment.",
        signal: new AbortController().signal,
        selection,
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
