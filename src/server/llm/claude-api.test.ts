import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { root } from "../../../test/ask-helpers.ts";
import { collect, request } from "../../../test/fake-claude.ts";
import type { AgentMessage } from "../../shared/agent-message.ts";
import { claudeApi } from "./claude-api.ts";

const stepLine = (title: string) =>
  JSON.stringify({
    title,
    anchors: [{ file: "src/upload.ts", symbol: "uploadClip" }],
    narration: [{ text: "It uploads a clip." }],
  });

function message(content: object[], stopReason = "end_turn") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 4000,
    },
  };
}

const answer = (...lines: string[]) => message([{ type: "text", text: lines.join("\n") }]);

const toolUse = (input: object, id = "toolu_1") =>
  message(
    [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Let me look." },
      { type: "tool_use", id, name: "read_file", input },
    ],
    "tool_use",
  );

type Script = (object | Error)[];

function fakeClient(script: Script) {
  const requests: ReturnType<typeof JSON.parse>[] = [];
  const client = {
    messages: {
      stream(params: unknown) {
        requests.push(structuredClone(params));
        const next = script[requests.length - 1];
        return {
          async finalMessage() {
            if (!next) throw new Error("the script has no more responses");
            if (next instanceof Error) throw next;
            return next;
          },
        };
      },
    },
  };
  return { client: client as never, requests };
}

function ask(script: Script, model?: string, part: Partial<typeof request> = {}) {
  const { client, requests } = fakeClient(script);
  const provider = claudeApi({ apiKey: "sk-ant-test", client, model });
  const events = collect(provider.ask({ ...request, root, ...part }, new AbortController().signal));
  return { requests, events };
}

describe("claudeApi", () => {
  it("streams steps and a check question, then done with usage and cost", async () => {
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
        cacheWriteTokens: 4000,
        costUsd: (1000 * 4 + 500 * 20 + 2000 * 0.2 + 4000 * 5) / 1_000_000,
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("sends the model, limits, effort and tools the plan names, with no thinking setting", async () => {
    const { events, requests } = ask([answer(stepLine("One"))]);
    await events;
    const [sent] = requests;
    expect(sent).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      tool_choice: { type: "auto" },
    });
    expect(sent).not.toHaveProperty("thinking");
    expect(sent.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read_file",
      "grep",
      "find_symbol",
      "git",
    ]);
    expect(sent.tools[0].input_schema.type).toBe("object");
    expect(sent.system).toBe(request.system);
  });

  it("sends the small model with low effort for a small request, whatever strong model is chosen", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], "claude-sonnet-5-5", {
      model: "small",
    });
    const result = await events;
    expect(requests[0]).toMatchObject({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
    });
    expect(result.at(-1)).toMatchObject({
      usage: { costUsd: (1000 * 0.1 + 500 * 0.5 + 2000 * 0.01 + 4000 * 0.125) / 1_000_000 },
    });
  });

  it("sends the chosen model for a strong request", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], "claude-sonnet-5-5");
    await events;
    expect(requests[0]).toMatchObject({ model: "claude-sonnet-5-5" });
  });

  describe("earlier turns", () => {
    const earlier: AgentMessage[] = [
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer", toolCalls: [] },
    ];

    it("sends them as messages after the repo context and before the question, with the cache marker on the last one", async () => {
      const { events, requests } = ask([answer(stepLine("One"))], undefined, {
        history: earlier,
        conversation: "Text rendering of the turns",
      });
      await events;
      expect(requests[0].messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: request.context, cache_control: { type: "ephemeral" } },
            { type: "text", text: "Earlier question" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Earlier answer", cache_control: { type: "ephemeral" } }],
        },
        { role: "user", content: [{ type: "text", text: request.question }] },
      ]);
      expect(JSON.stringify(requests[0])).not.toContain("Text rendering of the turns");
    });

    it("sends a finished turn back as the API returned it, thinking block included, in the next ask", async () => {
      const first = await ask([toolUse({ path: "src/upload.ts" }), answer(stepLine("One"))]).events;
      const done = first.at(-1);
      if (done?.type !== "done" || !done.messages) throw new Error("the ask did not finish");

      const { events, requests } = ask([answer(stepLine("Two"))], undefined, {
        history: done.messages,
        question: "And then?",
      });
      await events;
      const sent = requests[0].messages;
      expect(sent[1]).toEqual({
        role: "assistant",
        content: toolUse({ path: "src/upload.ts" }).content,
      });
      expect(sent[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
      expect(sent[3]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: stepLine("One") }],
      });
      expect(sent[4]).toEqual({ role: "user", content: [{ type: "text", text: "And then?" }] });
    });
  });

  it("uses low effort for the small model, and --model when given", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], "claude-haiku-5-5", {
      model: "small",
    });
    const result = await events;
    expect(requests[0]).toMatchObject({
      model: "claude-haiku-5-5",
      output_config: { effort: "low" },
    });
    expect(result.at(-1)).toMatchObject({
      usage: { costUsd: (1000 * 0.1 + 500 * 0.5 + 2000 * 0.01 + 4000 * 0.125) / 1_000_000 },
    });
  });

  it("prices claude-sonnet-5-5 and reports null cost for any other model", async () => {
    const sonnet = await ask([answer(stepLine("One"))], "claude-sonnet-5-5").events;
    expect(sonnet.at(-1)).toMatchObject({
      usage: { costUsd: (1000 * 2 + 500 * 10 + 2000 * 0.2 + 4000 * 2.5) / 1_000_000 },
    });
    const other = await ask([answer(stepLine("One"))], "my-model").events;
    expect(other.at(-1)).toMatchObject({ usage: { costUsd: null } });
  });

  it("offers no tools when the request has none", async () => {
    const { events, requests } = ask([answer(stepLine("One"))], undefined, { tools: false });
    await events;
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("tool_choice");
  });

  it("runs a requested tool directly and sends the wrapped result back with the thinking block", async () => {
    const { events, requests } = ask([toolUse({ path: "src/upload.ts" }), answer(stepLine("One"))]);
    const result = await events;
    expect(result.map((event) => event.type)).toEqual(["tool_call", "step", "done"]);
    expect(result[0]).toEqual({
      type: "tool_call",
      name: "read_file",
      input: { path: "src/upload.ts" },
    });
    const [, second] = requests;
    expect(second.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "src/upload.ts" } },
      ],
    });
    const [toolResult] = second.messages[2].content;
    expect(toolResult).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      is_error: false,
    });
    expect(toolResult.content).toContain('<untrusted_content tool="read_file">');
    expect(toolResult.content).toContain("uploadClip");
    expect(result[2]).toMatchObject({ usage: { inputTokens: 2000, outputTokens: 1000 } });
  });

  it("sends tool errors back as error results", async () => {
    const { events, requests } = ask([toolUse({ path: "../secret.txt" }), answer(stepLine("One"))]);
    await events;
    expect(requests[1].messages[2].content[0]).toMatchObject({
      type: "tool_result",
      is_error: true,
    });
  });

  it("makes the final call after a safety stop with the tools defined but not allowed", async () => {
    const { events, requests } = ask([
      toolUse({ path: "src/upload.ts" }, "toolu_1"),
      toolUse({ path: "src/upload.ts" }, "toolu_2"),
      answer(stepLine("Partial")),
    ]);
    const result = await events;
    expect(requests[2].tool_choice).toEqual({ type: "none" });
    expect(requests[2].tools).toHaveLength(4);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "step", "done"]);
  });

  it("gives a retryable error event for a rate limit", async () => {
    const error = Anthropic.APIError.generate(429, { type: "error" }, "Slow down", new Headers());
    const result = await ask([error]).events;
    expect(result).toEqual([
      { type: "error", message: expect.stringMatching(/rate limit/i), retryable: true },
    ]);
  });

  it("gives a retryable error event for a server error or a lost connection, and not for another client error", async () => {
    const failure = (status: number) =>
      Anthropic.APIError.generate(status, { type: "error" }, "Nope", new Headers());
    const server = await ask([failure(500)]).events;
    expect(server[0]).toMatchObject({ type: "error", retryable: true });
    const lost = await ask([new Anthropic.APIConnectionError({})]).events;
    expect(lost[0]).toMatchObject({ type: "error", retryable: true });
    const client = await ask([failure(400)]).events;
    expect(client[0]).toMatchObject({ type: "error", retryable: false });
  });

  it("tells the learner when the API key is rejected", async () => {
    const error = Anthropic.APIError.generate(401, { type: "error" }, "bad key", new Headers());
    const result = await ask([error]).events;
    expect(result).toEqual([
      { type: "error", message: expect.stringContaining("ANTHROPIC_API_KEY"), retryable: false },
    ]);
  });

  it("gives an error event when the model refuses or runs out of tokens", async () => {
    const refused = await ask([message([], "refusal")]).events;
    expect(refused[0]).toMatchObject({ type: "error", retryable: false });
    const cut = await ask([message([{ type: "text", text: "{" }], "max_tokens")]).events;
    expect(cut[0]).toMatchObject({ type: "error", message: expect.stringMatching(/cut off/i) });
  });

  it("ends quietly when the ask is aborted", async () => {
    const { client } = fakeClient([new Anthropic.APIUserAbortError()]);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      claudeApi({ apiKey: "sk-ant-test", client }).ask({ ...request, root }, controller.signal),
    );
    expect(events).toEqual([]);
  });
});
