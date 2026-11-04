import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { root } from "../../../test/ask-helpers.ts";
import { collect, request } from "../../../test/fake-claude.ts";
import type { AgentMessage } from "../../shared/agent-message.ts";
import { geminiApi } from "./gemini-api.ts";

const stepLine = (title: string) =>
  JSON.stringify({
    title,
    anchors: [{ file: "src/upload.ts", symbol: "uploadClip" }],
    narration: [{ text: "It uploads a clip." }],
  });

function response(parts: object[], finishReason = "STOP") {
  return {
    candidates: [{ content: { role: "model", parts }, finishReason }],
    usageMetadata: {
      promptTokenCount: 3000,
      cachedContentTokenCount: 2000,
      candidatesTokenCount: 400,
      thoughtsTokenCount: 100,
    },
  };
}

const answer = (...lines: string[]) => response([{ text: lines.join("\n") }]);

const toolUse = (args: object) =>
  response([
    { text: "Let me look.", thoughtSignature: "sig" },
    { functionCall: { name: "read_file", args } },
  ]);

type Script = (object | Error)[];

function fakeClient(script: Script) {
  const requests: ReturnType<typeof JSON.parse>[] = [];
  const client = {
    models: {
      async generateContent(params: unknown) {
        requests.push(structuredClone(params));
        const next = script[requests.length - 1];
        if (!next) throw new Error("the script has no more responses");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { client: client as never, requests };
}

function ask(script: Script, model?: string, part: Partial<typeof request> = {}) {
  const { client, requests } = fakeClient(script);
  const provider = geminiApi({ apiKey: "test-key", client, model });
  const events = collect(provider.ask({ ...request, root, ...part }, new AbortController().signal));
  return { requests, events };
}

const apiError = (status: number, message: string) => new ApiError({ status, message });

describe("geminiApi", () => {
  it("sends its one configured model for both a small and a strong request", async () => {
    for (const model of ["small", "strong"] as const) {
      const { events, requests } = ask([answer(stepLine("One"))], "gemini-test-model", { model });
      await events;
      expect(requests[0]).toMatchObject({ model: "gemini-test-model" });
    }
  });

  it("streams steps and a check question, then done with usage and null cost", async () => {
    const { events, requests } = ask([
      answer(stepLine("One"), stepLine("Two"), JSON.stringify({ checkQuestion: "Why?" })),
    ]);
    const result = await events;
    expect(result.map((event) => event.type)).toEqual(["step", "step", "checkQuestion", "done"]);
    expect(result[3]).toMatchObject({
      type: "done",
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 2000,
        cacheWriteTokens: 0,
        costUsd: null,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("sends the default stable model, the token limit, the system prompt and the tools", async () => {
    const { events, requests } = ask([answer(stepLine("One"))]);
    await events;
    const [sent] = requests;
    expect(sent.model).toBe("gemini-3.8-flash");
    expect(sent.model).not.toContain("preview");
    expect(sent.config).toMatchObject({
      maxOutputTokens: 16000,
      systemInstruction: request.system,
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    const [declarations] = sent.config.tools.map(
      (tool: { functionDeclarations: { name: string }[] }) => tool.functionDeclarations,
    );
    expect(declarations.map((tool: { name: string }) => tool.name)).toEqual([
      "read_file",
      "grep",
      "find_symbol",
      "git",
    ]);
    expect(declarations[0].parametersJsonSchema.type).toBe("object");
    expect(declarations[0].parametersJsonSchema).not.toHaveProperty("$schema");
  });

  it("sends the repo context and the question as the first user message", async () => {
    const { events, requests } = ask([answer(stepLine("One"))]);
    await events;
    expect(requests[0].contents).toEqual([
      { role: "user", parts: [{ text: request.context }, { text: request.question }] },
    ]);
  });

  describe("earlier turns", () => {
    const earlier: AgentMessage[] = [
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer", toolCalls: [] },
    ];

    it("sends them as contents after the repo context and before the question, not as text", async () => {
      const { events, requests } = ask([answer(stepLine("One"))], undefined, {
        history: earlier,
        conversation: "Text rendering of the turns",
      });
      await events;
      expect(requests[0].contents).toEqual([
        { role: "user", parts: [{ text: request.context }, { text: "Earlier question" }] },
        { role: "model", parts: [{ text: "Earlier answer" }] },
        { role: "user", parts: [{ text: request.question }] },
      ]);
      expect(JSON.stringify(requests[0])).not.toContain("Text rendering of the turns");
    });

    it("sends a finished turn back as the API returned it, thought signature included, in the next ask", async () => {
      const first = await ask([toolUse({ path: "src/upload.ts" }), answer(stepLine("One"))]).events;
      const done = first.at(-1);
      if (done?.type !== "done" || !done.messages) throw new Error("the ask did not finish");

      const { events, requests } = ask([answer(stepLine("Two"))], undefined, {
        history: done.messages,
        question: "And then?",
      });
      await events;
      const sent = requests[0].contents;
      expect(sent[1]).toEqual({
        role: "model",
        parts: [
          { text: "Let me look.", thoughtSignature: "sig" },
          { functionCall: { name: "read_file", args: { path: "src/upload.ts" } } },
        ],
      });
      expect(sent[2].parts[0].functionResponse.name).toBe("read_file");
      expect(sent[3]).toEqual({ role: "model", parts: [{ text: stepLine("One") }] });
      expect(sent[4]).toEqual({ role: "user", parts: [{ text: "And then?" }] });
    });
  });

  it("uses --model when given and still reports null cost", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], "gemini-3.8-pro");
    const result = await events;
    expect(requests[0].model).toBe("gemini-3.8-pro");
    expect(result.at(-1)).toMatchObject({ usage: { costUsd: null } });
  });

  it("offers no tools when the request has none", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], undefined, { tools: false });
    await events;
    expect(requests[0].config).not.toHaveProperty("tools");
    expect(requests[0].config).not.toHaveProperty("toolConfig");
  });

  it("runs a requested tool directly and sends the wrapped result back after the model's own turn", async () => {
    const { events, requests } = ask([toolUse({ path: "src/upload.ts" }), answer(stepLine("One"))]);
    const result = await events;
    expect(result.map((event) => event.type)).toEqual(["tool_call", "step", "done"]);
    expect(result[0]).toEqual({
      type: "tool_call",
      name: "read_file",
      input: { path: "src/upload.ts" },
    });
    const [, second] = requests;
    expect(second.contents[1]).toEqual({
      role: "model",
      parts: [
        { text: "Let me look.", thoughtSignature: "sig" },
        { functionCall: { name: "read_file", args: { path: "src/upload.ts" } } },
      ],
    });
    const [part] = second.contents[2].parts;
    expect(second.contents[2].role).toBe("user");
    expect(part.functionResponse.name).toBe("read_file");
    expect(part.functionResponse.response.output).toContain('<untrusted_content tool="read_file">');
    expect(part.functionResponse.response.output).toContain("uploadClip");
    expect(result[2]).toMatchObject({ usage: { inputTokens: 2000, outputTokens: 1000 } });
  });

  it("sends tool errors back as error results", async () => {
    const { events, requests } = ask([toolUse({ path: "../secret.txt" }), answer(stepLine("One"))]);
    await events;
    const { response } = requests[1].contents[2].parts[0].functionResponse;
    expect(response).toHaveProperty("error");
    expect(response).not.toHaveProperty("output");
  });

  it("makes the final call after a safety stop with the tools defined but not allowed", async () => {
    const { events, requests } = ask([
      toolUse({ path: "src/upload.ts" }),
      toolUse({ path: "src/upload.ts" }),
      answer(stepLine("Partial")),
    ]);
    const result = await events;
    expect(requests[2].config.toolConfig).toEqual({ functionCallingConfig: { mode: "NONE" } });
    expect(requests[2].config.tools[0].functionDeclarations).toHaveLength(4);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "step", "done"]);
  });

  it("gives a retryable error event for a rate limit", async () => {
    const result = await ask([apiError(429, "Resource exhausted")]).events;
    expect(result).toEqual([
      { type: "error", message: expect.stringMatching(/rate limit/i), retryable: true },
    ]);
  });

  it("tells the learner when the API key is rejected", async () => {
    const result = await ask([apiError(400, "API key not valid. Please pass a valid API key.")])
      .events;
    expect(result).toEqual([
      { type: "error", message: expect.stringContaining("GEMINI_API_KEY"), retryable: false },
    ]);
  });

  it("retries a server error but not another client error", async () => {
    const server = await ask([apiError(503, "Overloaded")]).events;
    expect(server[0]).toMatchObject({ type: "error", retryable: true });
    const client = await ask([apiError(404, "Model not found")]).events;
    expect(client[0]).toMatchObject({ type: "error", retryable: false });
  });

  it("gives an error event when the model is blocked or runs out of tokens", async () => {
    const blocked = await ask([response([], "SAFETY")]).events;
    expect(blocked[0]).toMatchObject({ type: "error", retryable: false });
    const empty = await ask([{ candidates: [] }]).events;
    expect(empty[0]).toMatchObject({ type: "error", retryable: false });
    const cut = await ask([response([{ text: "{" }], "MAX_TOKENS")]).events;
    expect(cut[0]).toMatchObject({ type: "error", message: expect.stringMatching(/cut off/i) });
  });

  it("ends quietly when the ask is aborted", async () => {
    const { client } = fakeClient([new Error("This operation was aborted")]);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      geminiApi({ apiKey: "test-key", client }).ask({ ...request, root }, controller.signal),
    );
    expect(events).toEqual([]);
  });
});
