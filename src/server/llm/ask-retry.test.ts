import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attempts,
  invalidStep,
  saveStep,
  stream,
  terminal,
  uploadStep,
  usage,
} from "../../../test/ask-helpers.ts";
import { key } from "../../../test/conversation-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { lostThread } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("askEvents step retry", () => {
  it("asks again after an invalid step, naming the step and the errors, and keeps the steps already sent", async () => {
    const seen: LLMRequest[] = [];
    const events = await collect(
      stream(
        attempts(
          [
            [{ type: "step", step: saveStep }, invalidStep],
            [
              { type: "step", step: uploadStep },
              { type: "done", usage },
            ],
          ],
          seen,
        ),
      ),
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]?.question).toContain("How are clips saved?");
    expect(seen[1]?.question).toContain("step 2");
    expect(seen[1]?.question).toContain("title: must not be empty");
    expect(seen[1]?.question).toContain("Saving a clip");
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "step", "tour", "done"]);
    expect(events.find((event) => event.type === "tour")?.tour.steps).toEqual([
      saveStep,
      uploadStep,
    ]);
  });

  it("ends the ask with an error when the retry also has an invalid step", async () => {
    terminal();
    const seen: LLMRequest[] = [];
    const events = await collect(
      stream(
        attempts(
          [[{ type: "step", step: saveStep }, invalidStep], [invalidStep], [invalidStep]],
          seen,
        ),
      ),
    );
    expect(seen).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["ack", "step", "error"]);
    expect(events.at(-1)).toEqual({ type: "error", message: lostThread });
  });

  it("ends the ask with an error when the retry fails another way", async () => {
    terminal();
    const events = await collect(
      stream(
        attempts([
          [invalidStep],
          [{ type: "error", message: "Claude Code reported an error", retryable: false }],
        ]),
      ),
    );
    expect(events.at(-1)).toEqual({ type: "error", message: "Claude Code reported an error" });
  });

  it("does not ask again after an error that is not an invalid step", async () => {
    terminal();
    const seen: LLMRequest[] = [];
    await collect(
      stream(
        attempts(
          [
            [
              {
                type: "error",
                message: lostThread,
                detail: "checkQuestion: bad",
                retryable: false,
              },
            ],
          ],
          seen,
        ),
      ),
    );
    expect(seen).toHaveLength(1);
  });

  it("redacts a secret in the validation errors before they reach the provider", async () => {
    const seen: LLMRequest[] = [];
    await collect(
      stream(
        attempts(
          [
            [
              {
                ...invalidStep,
                detail: `title: ${key}`,
              } as ProviderEvent,
            ],
            [{ type: "done", usage }],
          ],
          seen,
        ),
      ),
    );
    expect(seen[1]?.question).not.toContain("sk-ant-");
  });
});
