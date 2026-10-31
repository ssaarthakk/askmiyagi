import { describe, expect, it } from "vitest";
import { check, readme, run, save, uploadClip } from "../../../test/eval-helpers.ts";
import type { EvalRun } from "./code-checks.ts";

describe("highlights", () => {
  it("passes when every mustHighlight symbol is covered by a highlighted range", async () => {
    const checks = await check(run([{ range: uploadClip }, { range: save }]));
    expect(checks.highlights).toBe(true);
  });

  it("fails when a mustHighlight symbol is never highlighted", async () => {
    const checks = await check(run([{ range: save }]));
    expect(checks.highlights).toBe(false);
  });

  it("accepts a whole-file reference when any range in that file is highlighted", async () => {
    const checks = await check(run([{ range: readme }]), { mustHighlight: ["README.md"] });
    expect(checks.highlights).toBe(true);
  });

  it("normalises a whole-file reference through the path guard", async () => {
    const checks = await check(run([{ range: readme }]), { mustHighlight: ["./README.md"] });
    expect(checks.highlights).toBe(true);
  });

  it("fails when the anchor could not be resolved", async () => {
    const checks = await check(run([{ range: null }]));
    expect(checks.highlights).toBe(false);
  });
});

describe("flow order and starting point", () => {
  it("passes when the first anchor is the expected start and the order is followed", async () => {
    const checks = await check(run([{ range: uploadClip }, { range: save }]));
    expect(checks.startingPoint).toBe(true);
    expect(checks.flowOrder).toBe(true);
  });

  it("fails the order, but not the highlights, when the steps come in the wrong order", async () => {
    const checks = await check(run([{ range: save }, { range: uploadClip }]));
    expect(checks.highlights).toBe(true);
    expect(checks.startingPoint).toBe(false);
    expect(checks.flowOrder).toBe(false);
  });

  it("keeps the starting point right when only a later entry is missing", async () => {
    const checks = await check(run([{ range: uploadClip }]));
    expect(checks.startingPoint).toBe(true);
    expect(checks.flowOrder).toBe(false);
  });

  it("takes the starting point from the first step's first anchor only", async () => {
    const evalRun = run([{ range: save }]);
    const tourEvent = evalRun.events.find((event) => event.type === "tour");
    if (tourEvent?.type !== "tour") throw new Error("expected a tour");
    tourEvent.ranges = [[save, uploadClip]];
    expect((await check(evalRun)).startingPoint).toBe(false);
  });

  it("allows extra steps between the expected ones", async () => {
    const checks = await check(run([{ range: uploadClip }, { range: readme }, { range: save }]));
    expect(checks.flowOrder).toBe(true);
  });
});

describe("valid JSON", () => {
  it("passes for a run that ended with a tour", async () => {
    expect((await check(run([{ range: uploadClip }]))).validJson).toBe(true);
  });

  it("fails for a run that ended with an error", async () => {
    const failed: EvalRun = {
      ...run([]),
      events: [
        { type: "ack", text: "Okay." },
        { type: "error", message: "bad json" },
      ],
    };
    const checks = await check(failed);
    expect(checks.validJson).toBe(false);
    expect(checks.highlights).toBe(false);
    expect(checks.startingPoint).toBe(false);
    expect(checks.flowOrder).toBe(false);
  });
});

describe("anchor failure rate", () => {
  it("is the share of anchors that could not be resolved", async () => {
    const checks = await check(
      run([{ range: uploadClip }, { range: null }, { range: null }, { range: save }]),
    );
    expect(checks.anchorFailureRate).toBe(0.5);
  });

  it("is 0 when there are no anchors", async () => {
    expect((await check(run([], { reply: "It saves." }))).anchorFailureRate).toBe(0);
  });
});

describe("reported numbers", () => {
  it("reports latency, cost and tool-call count without judging them", async () => {
    const checks = await check(run([{ range: uploadClip }]));
    expect(checks.latencyMs).toBe(1200);
    expect(checks.costUsd).toBe(0.02);
    expect(checks.toolCalls).toBe(2);
  });

  it("leaves the cost out when the provider does not report it", async () => {
    const base = run([{ range: uploadClip }]);
    const checks = await check({ ...base, usage: { ...base.usage, costUsd: null } });
    expect(checks).not.toHaveProperty("costUsd");
  });
});
