import { describe, expect, it } from "vitest";
import {
  call,
  drive,
  failed,
  modelStep,
  numberedCalls,
  ok,
  scriptedModel,
  tool,
  toolOutputs,
} from "../../../test/agent-helpers.ts";

describe("runAgentLoop", () => {
  it("returns the model's text once it stops calling tools", async () => {
    const { model, seen } = scriptedModel([modelStep("Here is the answer.")]);
    const { events, result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.text).toBe("Here is the answer.");
    expect(result.stopped).toBeUndefined();
    expect(events).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tools.map(({ name }) => name)).toEqual(["read_file"]);
  });

  it("runs the tools the model asks for and returns every message, results wrapped as untrusted", async () => {
    const readFile = tool("read_file", () => ok("export const a = 1;"));
    const calls = [call("read_file", { path: "a.ts" }, "c1")];
    const { model } = scriptedModel([modelStep("Looking.", calls), modelStep("Done.")]);
    const { events, result } = await drive(model, [readFile.agentTool]);
    expect(events).toEqual([{ type: "tool_call", name: "read_file", input: { path: "a.ts" } }]);
    expect(readFile.runs).toEqual([{ path: "a.ts" }]);
    expect(result.messages).toEqual([
      { role: "user", text: "How are clips saved?" },
      { role: "assistant", text: "Looking.", toolCalls: calls },
      {
        role: "tool",
        outputs: [
          {
            callId: "c1",
            name: "read_file",
            text: '<untrusted_content tool="read_file">export const a = 1;</untrusted_content>',
            isError: false,
          },
        ],
      },
      { role: "assistant", text: "Done.", toolCalls: [] },
    ]);
  });

  it("includes the stop note and the partial answer after a safety stop", async () => {
    const { model } = scriptedModel([
      ...numberedCalls(1),
      modelStep("", [call("read_file", { n: 0 }, "again")]),
      modelStep("Partial."),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.stopped).toBe("repeated_call");
    expect(result.messages.at(-2)).toMatchObject({
      role: "user",
      text: expect.stringContaining("Answer now without tools"),
    });
    expect(result.messages.at(-1)).toEqual({ role: "assistant", text: "Partial.", toolCalls: [] });
  });

  it("adds up the usage and cost of every call", async () => {
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })], { costUsd: 0.1 }),
      modelStep("Done.", [], { costUsd: 0.2, cacheReadTokens: 7 }),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
      costUsd: expect.closeTo(0.3, 10),
    });
  });

  it("reports an unknown tool to the model as an error result", async () => {
    const { model, seen } = scriptedModel([
      modelStep("", [call("rm_rf", {}, "c1")]),
      modelStep("Sorry."),
    ]);
    await drive(model, [tool("read_file").agentTool]);
    expect(toolOutputs(seen[1]?.messages)[0]).toMatchObject({ isError: true });
    expect(toolOutputs(seen[1]?.messages)[0]?.text).toContain("Unknown tool: rm_rf");
  });

  it("keeps going when tool errors are not in a row", async () => {
    const results = [failed("x"), failed("x"), ok("y"), failed("x"), failed("x")];
    const readFile = tool("read_file", () => results.shift() ?? ok("y"));
    const { model } = scriptedModel([...numberedCalls(5), modelStep("Done.")]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(result.stopped).toBeUndefined();
  });
});
