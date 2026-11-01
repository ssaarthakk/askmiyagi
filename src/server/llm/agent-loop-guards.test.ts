import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

const warning = "3 steps left, wrap up.";

describe("runAgentLoop safety stops", () => {
  it("stops when the model asks for a 21st tool call and makes one final call with tools off", async () => {
    const readFile = tool("read_file");
    const { model, seen } = scriptedModel([
      ...numberedCalls(21),
      modelStep("Here is what I found so far."),
    ]);
    const { events, result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toHaveLength(20);
    expect(events).toHaveLength(20);
    expect(seen).toHaveLength(22);
    expect(seen[21]?.tools).toEqual([]);
    expect(result).toMatchObject({ text: "Here is what I found so far.", stopped: "tool_limit" });
  });

  it("lets the model answer after its 20th tool call", async () => {
    const { model } = scriptedModel([...numberedCalls(20), modelStep("All good.")]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.stopped).toBeUndefined();
    expect(result.text).toBe("All good.");
  });

  it("asks the final call for an honest partial answer", async () => {
    const { model, seen } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("Partial."),
    ]);
    await drive(model, [tool("read_file").agentTool]);
    const last = seen[2]?.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(last && "text" in last ? last.text : "").toMatch(/partial/i);
  });

  it("includes the final call's usage", async () => {
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("Partial.", [], { inputTokens: 1000 }),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.usage.inputTokens).toBe(10 + 10 + 1000);
  });

  it("appends the 3-steps-left warning to the last tool result of call 17 only", async () => {
    const { model, seen } = scriptedModel([...numberedCalls(20), modelStep("Done.")]);
    await drive(model, [tool("read_file").agentTool]);
    const warned = (index: number) =>
      toolOutputs(seen[index]?.messages).filter(({ text }) => text.endsWith(warning));
    expect(warned(16)).toHaveLength(0);
    expect(warned(17)).toHaveLength(1);
    expect(toolOutputs(seen[17]?.messages).at(-1)?.text).toMatch(/3 steps left/);
    expect(warned(20)).toHaveLength(1);
  });

  it("puts the warning after the untrusted block, never inside it", async () => {
    const { model, seen } = scriptedModel([...numberedCalls(17), modelStep("Done.")]);
    await drive(model, [tool("read_file", () => ok("body")).agentTool]);
    expect(toolOutputs(seen[17]?.messages).at(-1)?.text).toBe(
      `<untrusted_content tool="read_file">body</untrusted_content>\n${warning}`,
    );
  });

  it("stops when the time limit of 90 seconds has passed", async () => {
    vi.useFakeTimers();
    const readFile = tool("read_file");
    const { model, seen } = scriptedModel([
      () => {
        vi.advanceTimersByTime(91_000);
        return modelStep("", [call("read_file", { n: 1 })]);
      },
      modelStep("Out of time."),
    ]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toEqual([]);
    expect(seen[1]?.tools).toEqual([]);
    expect(result).toMatchObject({ text: "Out of time.", stopped: "time_limit" });
  });

  it("keeps going just under the time limit", async () => {
    vi.useFakeTimers();
    const { model } = scriptedModel([
      () => {
        vi.advanceTimersByTime(89_000);
        return modelStep("", [call("read_file", { n: 1 })]);
      },
      modelStep("Done."),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.stopped).toBeUndefined();
  });

  it("counts time the ask already used against the time limit", async () => {
    vi.useFakeTimers();
    const readFile = tool("read_file");
    const { model } = scriptedModel([
      () => {
        vi.advanceTimersByTime(31_000);
        return modelStep("", [call("read_file", { n: 1 })]);
      },
      modelStep("Out of time."),
    ]);
    const startedAt = Date.now() - 60_000;
    const { result } = await drive(model, [readFile.agentTool], undefined, undefined, startedAt);
    expect(readFile.runs).toEqual([]);
    expect(result.stopped).toBe("time_limit");
  });

  it("stops when the token budget of 150k tokens is spent", async () => {
    const readFile = tool("read_file");
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })], {
        inputTokens: 100_000,
        cacheReadTokens: 50_000,
      }),
      modelStep("Partial."),
    ]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toEqual([]);
    expect(result).toMatchObject({ text: "Partial.", stopped: "budget" });
  });

  it.each([
    { part: "output", usage: { inputTokens: 149_995, outputTokens: 5 } },
    { part: "cache write", usage: { inputTokens: 100_000, cacheWriteTokens: 50_000 } },
  ])("counts $part tokens against the token budget", async ({ usage }) => {
    const readFile = tool("read_file");
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })], usage),
      modelStep("Partial."),
    ]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toEqual([]);
    expect(result.stopped).toBe("budget");
  });

  it("stops when the cost budget of $1 is spent", async () => {
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })], { costUsd: 1 }),
      modelStep("Partial."),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.stopped).toBe("budget");
  });

  it("keeps going when the cost is just under $1 and the tokens under 150k", async () => {
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })], {
        costUsd: 0.99,
        inputTokens: 100_000,
        outputTokens: 49_999,
      }),
      modelStep("Done."),
    ]);
    const { result } = await drive(model, [tool("read_file").agentTool]);
    expect(result.stopped).toBeUndefined();
  });

  it("counts usage already spent on the ask against the budget, without adding it to the result", async () => {
    const readFile = tool("read_file");
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("Partial."),
    ]);
    const spent = {
      inputTokens: 149_990,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    };
    const { result } = await drive(model, [readFile.agentTool], undefined, spent);
    expect(readFile.runs).toEqual([]);
    expect(result).toMatchObject({ stopped: "budget", usage: { inputTokens: 20 } });
  });

  it("stops at the second identical call, whatever the key order", async () => {
    const readFile = tool("read_file");
    const { model, seen } = scriptedModel([
      modelStep("", [call("read_file", { path: "a.ts", start: 1 })]),
      modelStep("", [call("read_file", { start: 1, path: "a.ts" })]),
      modelStep("Partial."),
    ]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toHaveLength(1);
    expect(seen[2]?.tools).toEqual([]);
    expect(result).toMatchObject({ text: "Partial.", stopped: "repeated_call" });
  });

  it("allows the same input on different tools", async () => {
    const { model } = scriptedModel([
      modelStep("", [call("read_file", { name: "a" }), call("find_symbol", { name: "a" })]),
      modelStep("Done."),
    ]);
    const { result } = await drive(model, [
      tool("read_file").agentTool,
      tool("find_symbol").agentTool,
    ]);
    expect(result.stopped).toBeUndefined();
  });

  it("stops after 3 tool errors in a row", async () => {
    const readFile = tool("read_file", () => failed("No such file"));
    const { model, seen } = scriptedModel([...numberedCalls(3), modelStep("Partial.")]);
    const { result } = await drive(model, [readFile.agentTool]);
    expect(readFile.runs).toHaveLength(3);
    expect(seen[3]?.tools).toEqual([]);
    expect(result).toMatchObject({ text: "Partial.", stopped: "tool_errors" });
  });

  it("answers every call of a stopped step, so the history stays valid", async () => {
    const { model, seen } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 }, "c1"), call("read_file", { n: 1 }, "c2")]),
      modelStep("Partial."),
    ]);
    await drive(model, [tool("read_file").agentTool]);
    const outputs = toolOutputs(seen[1]?.messages);
    expect(outputs.map(({ callId }) => callId)).toEqual(["c1", "c2"]);
    expect(outputs[1]).toMatchObject({ isError: true });
  });

  it("stops without a final call when the user aborts", async () => {
    const controller = new AbortController();
    const readFile = tool("read_file", () => {
      controller.abort();
      return ok("fine");
    });
    const { model, seen } = scriptedModel([
      modelStep("", [call("read_file", { n: 1 })]),
      modelStep("Should not be asked."),
    ]);
    const { result } = await drive(model, [readFile.agentTool], controller.signal);
    expect(seen).toHaveLength(1);
    expect(result.stopped).toBe("aborted");
  });
});
