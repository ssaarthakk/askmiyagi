import { describe, expect, it } from "vitest";
import { root } from "../../../test/ask-helpers.ts";
import type { EvalCase } from "../../shared/eval-suite.ts";
import { classifyFailure } from "./failure.ts";

const evalCase: EvalCase = {
  question: "How does a clip get saved?",
  intent: "understand saving",
  mustHighlight: ["src/clip-service.ts#ClipService.save", "README.md"],
  expectedOrder: [],
  keyFacts: [],
};

const passing = { validJson: true, highlights: true, latencyMs: 12 };
const bothOpened = ["src/clip-service.ts", "README.md"];

function classify(
  checks: Record<string, boolean | number>,
  filesOpened: string[],
  mode: "brute-force" | "agentic" | null = "agentic",
) {
  return classifyFailure(root, evalCase, { checks, filesOpened, mode });
}

describe("classifyFailure", () => {
  it("leaves a run whose checks all pass unlabelled, even if a file was never opened", async () => {
    expect(await classify(passing, ["README.md"])).toBeUndefined();
  });

  it("ignores reported numbers when deciding whether a run failed", async () => {
    expect(await classify({ ...passing, anchorFailureRate: 1, latencyMs: 99999 }, bothOpened)).toBe(
      undefined,
    );
  });

  it("labels a failed run a retrieval miss when a mustHighlight file was never opened", async () => {
    expect(await classify({ ...passing, highlights: false }, ["README.md"])).toBe("retrieval-miss");
  });

  it("labels a failed run a reasoning miss when every mustHighlight file was opened", async () => {
    expect(await classify({ ...passing, highlights: false }, bothOpened)).toBe("reasoning-miss");
  });

  it("matches opened paths however the model wrote them", async () => {
    const written = ["./src/clip-service.ts", "README.md"];
    expect(await classify({ ...passing, highlights: false }, written)).toBe("reasoning-miss");
  });

  it("counts every file as opened in brute-force mode", async () => {
    expect(await classify({ ...passing, highlights: false }, [], "brute-force")).toBe(
      "reasoning-miss",
    );
  });

  it("counts a provider error or invalid JSON as a reasoning miss, whatever was opened", async () => {
    expect(await classify({ ...passing, validJson: false, highlights: false }, [])).toBe(
      "reasoning-miss",
    );
  });

  it("labels a failed non-retrieval check a retrieval miss when a file was never opened", async () => {
    expect(await classify({ ...passing, noCodeInNarration: false }, ["README.md"])).toBe(
      "retrieval-miss",
    );
  });
});
