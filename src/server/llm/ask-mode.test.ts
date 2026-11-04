import { describe, expect, it } from "vitest";
import { root, saveStep, scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { defaultProfile, type Profile } from "../../shared/profile.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

const events: ProviderEvent[] = [
  { type: "step", step: saveStep },
  { type: "checkQuestion", text: "What does save return?" },
  { type: "done", usage },
];

async function ask(options: { profile?: Profile | null; mode?: Profile["mode"] }) {
  const seen: LLMRequest[] = [];
  const conversation = createConversation();
  const result = await collect(
    askEvents({
      root,
      provider: scripted(events, seen),
      question: "How are clips saved?",
      ack: "One moment.",
      signal: new AbortController().signal,
      conversation,
      loadProfile: async () => options.profile ?? null,
      mode: options.mode,
    }),
  );
  const tour = result.find((event) => event.type === "tour");
  if (tour?.type !== "tour") throw new Error("expected a tour");
  return { tour: tour.tour, request: seen[0], conversation };
}

describe("teach and answer modes", () => {
  it("keeps the check question in teach mode, which is the default", async () => {
    const { tour, request } = await ask({ profile: null });

    expect(tour.checkQuestion).toBe("What does save return?");
    expect(request?.system).not.toContain("Answer mode");
  });

  it("drops the check question when the saved profile is in answer mode", async () => {
    const { tour, request, conversation } = await ask({
      profile: { ...defaultProfile, mode: "answer" },
    });

    expect(tour.checkQuestion).toBeUndefined();
    expect(tour.steps).toEqual([saveStep]);
    expect(request?.system).toContain("Answer mode");
    expect(conversation.render()).not.toContain("What does save return?");
  });

  it("uses the mode it is given over the profile, as the evals do", async () => {
    const answer = await ask({ profile: null, mode: "answer" });
    expect(answer.tour.checkQuestion).toBeUndefined();

    const teach = await ask({ profile: { ...defaultProfile, mode: "answer" }, mode: "teach" });
    expect(teach.tour.checkQuestion).toBe("What does save return?");
  });
});
