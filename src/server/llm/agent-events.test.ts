import { describe, expect, it } from "vitest";
import { call, modelStep, scriptedModel } from "../../../test/agent-helpers.ts";
import { root } from "../../../test/ask-helpers.ts";
import { collect, request } from "../../../test/fake-claude.ts";
import type { AgentMessage } from "../../shared/agent-message.ts";
import { agentProvider } from "./agent-events.ts";
import type { ModelStep } from "./agent-loop.ts";

const stepLine = JSON.stringify({
  title: "One",
  anchors: [{ file: "src/upload.ts", symbol: "uploadClip" }],
  narration: [{ text: "It uploads a clip." }],
});

const readUpload = call("read_file", { path: "src/upload.ts" }, "call_1");

function ask(script: ModelStep[], part: Partial<typeof request> = {}) {
  const { model, seen } = scriptedModel(script);
  const provider = agentProvider({
    buildModel: () => model,
    apiError: () => ({ type: "error", message: "api", retryable: false }),
  });
  const events = collect(provider.ask({ ...request, root, ...part }, new AbortController().signal));
  return { events, seen };
}

describe("agentProvider", () => {
  it("hands back this turn's messages on done, without the earlier ones", async () => {
    const earlier: AgentMessage[] = [
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer", toolCalls: [] },
    ];
    const result = await ask([modelStep("Let me look.", [readUpload]), modelStep(stepLine)], {
      history: earlier,
    }).events;

    expect(result.at(-1)).toMatchObject({
      type: "done",
      messages: [
        { role: "user", text: request.question },
        { role: "assistant", text: "Let me look.", toolCalls: [readUpload] },
        { role: "tool", outputs: [{ callId: "call_1", name: "read_file", isError: false }] },
        { role: "assistant", text: stepLine, toolCalls: [] },
      ],
    });
  });

  it("does not treat text before a tool call as part of the answer", async () => {
    const result = await ask([modelStep("Let me look.", [readUpload]), modelStep(stepLine)]).events;

    expect(result.map((event) => event.type)).toEqual(["tool_call", "step", "done"]);
  });

  it("gives plain reply text as a text event", async () => {
    const result = await ask([modelStep("You are welcome.")]).events;

    expect(result[0]).toEqual({ type: "text", text: "You are welcome." });
  });

  it("marks an invalid step with the ask's usage so the ask can retry from it", async () => {
    const result = await ask([modelStep(JSON.stringify({ title: "No anchors" }))]).events;

    expect(result[0]).toMatchObject({
      type: "error",
      invalidStep: true,
      retryable: false,
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("counts usage and time the ask already spent against the loop limits", async () => {
    const spent = {
      inputTokens: 150_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    };
    const overBudget = ask([modelStep(stepLine)], { spent });
    await overBudget.events;
    const overTime = ask([modelStep(stepLine)], { startedAt: Date.now() - 91_000 });
    await overTime.events;

    expect(overBudget.seen.map(({ tools }) => tools)).toEqual([[]]);
    expect(overTime.seen.map(({ tools }) => tools)).toEqual([[]]);
  });
});
