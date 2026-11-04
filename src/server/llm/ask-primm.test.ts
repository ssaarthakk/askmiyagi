import { afterEach, describe, expect, it, vi } from "vitest";
import {
  questionOptions,
  retryConcept,
  saveStep,
  scripted,
  stream,
  terminal,
  uploadStep,
  usage,
} from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
import type { Step } from "../../shared/tour.ts";
import { createConversation } from "./conversation.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const primm = {
  predict: "What do you think save returns?",
  investigate: "Click the line where the clip is saved.",
  target: { file: "src/clip-service.ts", symbol: "ClipService.save" },
};

const primmStep: Step = { ...saveStep, primm };
const secondPrimmStep: Step = { ...uploadStep, primm };

function events(steps: Step[], scope?: "side" | "new"): ProviderEvent[] {
  return [
    ...steps.map((step) => ({ type: "step" as const, step })),
    {
      type: "checkQuestion",
      text: "How would you change this to retry?",
      concept: retryConcept.name,
    },
    ...(scope ? [{ type: "scope" as const, scope }] : []),
    { type: "concepts", concepts: [retryConcept] },
    { type: "done", usage },
  ];
}

async function ask(
  steps: Step[],
  options: {
    frequency?: Profile["frequency"];
    mode?: Profile["mode"];
    current?: { tour: string; step: number; segmentIndex: number };
    scope?: "side" | "new";
    unresolvable?: boolean;
  } = {},
) {
  const seen: LLMRequest[] = [];
  const result = await collect(
    stream(scripted(events(steps, options.scope), seen), undefined, createConversation(), {
      ...questionOptions(options),
      current: options.current,
    }),
  );
  const tour = result.find((event) => event.type === "tour");
  if (tour?.type !== "tour") throw new Error("expected a tour");
  const streamed = result.flatMap((event) => (event.type === "step" ? [event] : []));
  return { tour: tour.tour, tourRanges: tour.ranges, streamed, request: seen[0] };
}

describe("askEvents PRIMM", () => {
  it("keeps the primm of the first step that has one and drops the later ones", async () => {
    terminal();
    const { tour, streamed } = await ask([primmStep, secondPrimmStep]);

    expect(tour.steps[0]?.primm).toEqual(primm);
    expect(tour.steps[1]?.primm).toBeUndefined();
    expect(streamed.map((event) => event.step.primm !== undefined)).toEqual([true, false]);
  });

  it("resolves the target after the step's anchors, in the streamed step and in the tour", async () => {
    const { tourRanges, streamed } = await ask([primmStep]);

    expect(streamed[0]?.ranges).toHaveLength(2);
    expect(streamed[0]?.ranges[1]).toEqual(streamed[0]?.ranges[0]);
    expect(streamed[0]?.ranges[1]?.file).toBe("src/clip-service.ts");
    expect(tourRanges[0]).toEqual(streamed[0]?.ranges);
  });

  it("gives a target that does not resolve no range", async () => {
    terminal();
    const lost = {
      ...primmStep,
      primm: { ...primm, target: { file: "src/nope.ts", symbol: "x" } },
    };
    const { streamed } = await ask([lost]);

    expect(streamed[0]?.ranges).toHaveLength(2);
    expect(streamed[0]?.ranges[1]).toBeNull();
  });

  it("leaves a step without primm with one range per anchor", async () => {
    const { streamed } = await ask([saveStep]);

    expect(streamed[0]?.ranges).toHaveLength(1);
  });

  it("drops the primm when no question is allowed for this tour", async () => {
    const { tour } = await ask([primmStep], { frequency: "normal" });

    expect(tour.steps[0]?.primm).toBeUndefined();
  });

  it("drops the primm in answer mode", async () => {
    const { tour } = await ask([primmStep], { mode: "answer" });

    expect(tour.steps[0]?.primm).toBeUndefined();
  });

  it("keeps the primm when the learner was looking at a tour and moved to a new topic", async () => {
    const { tour, streamed } = await ask([primmStep], {
      current: { tour: "Earlier", step: 0, segmentIndex: 0 },
      scope: "new",
    });

    expect(tour.steps[0]?.primm).toEqual(primm);
    expect(streamed[0]?.step.primm).toEqual(primm);
  });

  it("drops the primm and its target range from a tour that ends as a side question", async () => {
    const { tour, tourRanges } = await ask([primmStep], {
      current: { tour: "Earlier", step: 0, segmentIndex: 0 },
      scope: "side",
    });

    expect(tour.steps[0]?.primm).toBeUndefined();
    expect(tourRanges[0]).toHaveLength(1);
  });

  it("tells the model how to write a PRIMM step only when a question is allowed", async () => {
    const allowed = await ask([saveStep]);
    const refused = await ask([saveStep], { frequency: "normal" });

    expect(allowed.request?.question).toContain("primm");
    expect(refused.request?.question).not.toContain("primm");
  });
});
