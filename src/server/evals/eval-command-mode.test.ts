import { describe, expect, it, vi } from "vitest";
import { saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { runEval } from "./eval-command.ts";

const seen: LLMRequest[] = [];

vi.mock("../llm/choose-provider.ts", () => ({
  chooseProvider: async () => ({
    ok: true,
    value: scripted(
      [
        { type: "step", step: saveStep },
        { type: "done", usage },
      ],
      seen,
    ),
  }),
}));

describe("runEval --mode", () => {
  it("asks in answer mode when --mode answer is given", async () => {
    await runEval(
      ["--suite", "fixtures", "--provider", "fake", "--runs", "1", "--mode", "answer"],
      await tempDir(),
    );
    expect(seen[0]?.system).toContain("Answer mode");
  });
});
