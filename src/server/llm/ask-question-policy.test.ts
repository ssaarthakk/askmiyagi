import { afterEach, describe, expect, it, vi } from "vitest";
import {
  questionOptions,
  saveStep,
  scripted,
  stream,
  terminal,
  usage,
} from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { TourConcept } from "../../shared/learner.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
import type { Tour } from "../../shared/tour.ts";
import { createQuestionPolicy, type QuestionPolicy } from "../teach/question-policy.ts";
import { createConversation } from "./conversation.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const retries: TourConcept = { name: "Upload retries", important: true, kind: "repo" };
const minor: TourConcept = { name: "Clip ids", important: false, kind: "repo" };

function tourEvents(
  options: { concept?: string | undefined; concepts?: TourConcept[]; scope?: Tour["scope"] } = {},
): ProviderEvent[] {
  const { concept = "upload retries", concepts = [retries, minor], scope } = options;
  return [
    { type: "step", step: saveStep },
    { type: "checkQuestion", text: "Why does it retry?", ...(concept && { concept }) },
    ...(scope ? [{ type: "scope" as const, scope }] : []),
    { type: "concepts", concepts },
    { type: "done", usage },
  ];
}

async function ask(
  events: ProviderEvent[],
  options: {
    policy?: QuestionPolicy;
    frequency?: Profile["frequency"];
    mode?: Profile["mode"];
    checked?: string[];
    question?: string;
  } = {},
) {
  const seen: LLMRequest[] = [];
  const result = await collect(
    stream(scripted(events, seen), undefined, createConversation(), {
      question: options.question ?? "How are clips saved?",
      ...questionOptions(options),
    }),
  );
  const tour = result.find((event) => event.type === "tour");
  if (tour?.type !== "tour") throw new Error("expected a tour");
  return { tour: tour.tour, request: seen[0] };
}

describe("askEvents question policy", () => {
  it("keeps a question about an important concept of the tour that is not checked yet, and names the concept", async () => {
    const { tour } = await ask(tourEvents());

    expect(tour.checkQuestion).toBe("Why does it retry?");
    expect(tour.checkConcept).toBe("Upload retries");
  });

  it("drops the question when the model names no concept", async () => {
    terminal();
    expect((await ask(tourEvents({ concept: "" }))).tour.checkQuestion).toBeUndefined();
  });

  it("drops the question when the named concept is not in the tour's concepts", async () => {
    terminal();
    const { tour } = await ask(tourEvents({ concept: "rate limits" }));

    expect(tour.checkQuestion).toBeUndefined();
    expect(tour.checkConcept).toBeUndefined();
  });

  it("drops the question when the named concept is not important", async () => {
    terminal();
    expect((await ask(tourEvents({ concept: "Clip ids" }))).tour.checkQuestion).toBeUndefined();
  });

  it("drops the question when the concept is already checked, ignoring case", async () => {
    terminal();
    const { tour } = await ask(tourEvents(), { checked: ["UPLOAD retries"] });

    expect(tour.checkQuestion).toBeUndefined();
  });

  it("never keeps a question on a tour that ends with the side scope", async () => {
    terminal();
    expect((await ask(tourEvents({ scope: "side" }))).tour.checkQuestion).toBeUndefined();
    expect((await ask(tourEvents({ scope: "new" }))).tour.checkQuestion).toBe("Why does it retry?");
  });

  it("never keeps a question when the answer has no steps", async () => {
    terminal();
    const { tour } = await ask([
      { type: "text", text: "Sure." },
      { type: "checkQuestion", text: "Why does it retry?", concept: "upload retries" },
      { type: "concepts", concepts: [retries] },
      { type: "done", usage },
    ]);

    expect(tour.checkQuestion).toBeUndefined();
  });

  it("drops the question in answer mode, and counts nothing for the schedule", async () => {
    terminal();
    const policy = createQuestionPolicy();

    const answer = await ask(tourEvents(), { mode: "answer", policy });
    const teach = await ask(tourEvents(), { frequency: "normal", policy });

    expect(answer.tour.checkQuestion).toBeUndefined();
    expect(teach.tour.checkQuestion).toBeUndefined();
    expect(teach.request?.question).toContain("Do not add a checkQuestion line");
  });

  it("follows the frequency across asks and drops a question the schedule does not allow", async () => {
    terminal();
    const policy = createQuestionPolicy();

    const first = await ask(tourEvents(), { frequency: "normal", policy });
    const second = await ask(tourEvents(), { frequency: "normal", policy });

    expect(first.tour.checkQuestion).toBeUndefined();
    expect(second.tour.checkQuestion).toBe("Why does it retry?");
  });

  it("does not count a side tour as an eligible tour", async () => {
    terminal();
    const policy = createQuestionPolicy();

    await ask(tourEvents({ scope: "side" }), { frequency: "normal", policy });
    const next = await ask(tourEvents(), { frequency: "normal", policy });

    expect(next.tour.checkQuestion).toBeUndefined();
  });

  it("tells the model whether a question is allowed and which concepts are already checked", async () => {
    const allowed = await ask(tourEvents(), { checked: ["Upload retries", "Promises"] });
    const denied = await ask(tourEvents(), { frequency: "light" });

    expect(allowed.request?.question).toContain("may end this answer with one check question");
    expect(allowed.request?.question).toMatch(
      /<untrusted_content tool="checked_concepts">.*Promises.*<\/untrusted_content>/s,
    );
    expect(allowed.request?.question).toContain("Upload retries");
    expect(denied.request?.question).toContain("Do not add a checkQuestion line");
    expect(denied.request?.question).not.toContain("may end this answer");
  });

  it("allows no question without a policy", async () => {
    terminal();
    const result = await collect(stream(scripted(tourEvents())));

    expect(result.find((event) => event.type === "tour")).toMatchObject({
      tour: { steps: [saveStep] },
    });
    expect(result.find((event) => event.type === "tour")).not.toMatchObject({
      tour: { checkQuestion: expect.anything() },
    });
  });
});
