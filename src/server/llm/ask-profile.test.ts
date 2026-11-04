import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const profile: Profile = {
  level: "advanced",
  mode: "teach",
  frequency: "normal",
  goal: "Add a retry to uploads",
};

async function requestFor(profileOption: Profile | null) {
  const seen: LLMRequest[] = [];
  const provider = scripted(
    [
      { type: "step", step: saveStep },
      { type: "done", usage },
    ],
    seen,
  );
  await collect(
    askEvents({
      root,
      provider,
      question: "How are clips saved?",
      ack: "One moment.",
      signal: new AbortController().signal,
      conversation: createConversation(),
      loadProfile: async () => profileOption,
    }),
  );
  return seen[0];
}

describe("askEvents profile", () => {
  it("puts the learner's level and goal in the request, with the goal untrusted", async () => {
    const request = await requestFor(profile);

    expect(request?.question).toContain("advanced");
    expect(request?.question).toContain(
      '<untrusted_content tool="goal">Add a retry to uploads</untrusted_content>',
    );
    expect(request?.question).toContain("How are clips saved?");
  });

  it("sends the ack before it reads the profile", async () => {
    const loadProfile = vi.fn(async () => profile);
    const events = askEvents({
      root,
      provider: scripted([{ type: "done", usage }]),
      question: "How are clips saved?",
      ack: "One moment.",
      signal: new AbortController().signal,
      conversation: createConversation(),
      loadProfile,
    });

    expect((await events.next()).value).toEqual({ type: "ack", text: "One moment." });
    expect(loadProfile).not.toHaveBeenCalled();
    await collect(events);
    expect(loadProfile).toHaveBeenCalledOnce();
  });

  it("adds nothing when there is no profile yet", async () => {
    const request = await requestFor(null);

    expect(request?.question).not.toContain("untrusted_content");
    expect(request?.question).not.toContain("level");
  });
});
