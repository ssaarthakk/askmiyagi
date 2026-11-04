import { afterEach, describe, expect, it, vi } from "vitest";
import { saveStep, usage } from "../../../test/ask-helpers.ts";
import {
  cleanAskRoute,
  loggedCallTypes,
  requests,
  saveFrequentProfile,
  startAsk,
} from "../../../test/ask-route-harness.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMProvider } from "../llm/provider.ts";

afterEach(cleanAskRoute);

describe("createAskHandler question policy", () => {
  const kept = "Explain Upload retries back to me in your own words.";
  const questionProvider: LLMProvider = {
    async *ask(request) {
      requests.push(request);
      yield { type: "step", step: saveStep };
      yield { type: "checkQuestion", text: "Why does it retry?", concept: "upload retries" };
      yield {
        type: "concepts",
        concepts: [{ name: "Upload retries", important: true, kind: "repo" }],
      };
      yield { type: "done", usage };
    },
  };

  async function asked(post: (body: object, path?: string) => Promise<Response>, question: string) {
    return (await post({ question })).text();
  }

  it("stops asking questions for 3 tours after two skipped ones in a row", async () => {
    const { tutorRoot, post } = await startAsk(true, questionProvider);
    await saveFrequentProfile(tutorRoot);

    expect(await asked(post, "First?")).toContain(kept);
    expect((await post({ tour: "First?" }, "/api/skipped")).status).toBe(204);
    expect(await asked(post, "Second?")).toContain(kept);
    expect((await post({ tour: "Second?" }, "/api/skipped")).status).toBe(204);

    for (const question of ["Third?", "Fourth?", "Fifth?"]) {
      expect(await asked(post, question)).not.toContain(kept);
      expect(requests.at(-1)?.question).toContain("Do not add a checkQuestion line");
    }
    expect(await asked(post, "Sixth?")).toContain(kept);
  });

  it("ignores a skip for a tour that asked no question, and refuses a malformed body", async () => {
    const { tutorRoot, post } = await startAsk(true);
    await saveFrequentProfile(tutorRoot);
    await asked(post, "First?");
    await asked(post, "Second?");

    expect((await post({ tour: "First?" }, "/api/skipped")).status).toBe(204);
    expect((await post({ tour: "Second?" }, "/api/skipped")).status).toBe(204);
    expect((await post({ tour: "Unknown" }, "/api/skipped")).status).toBe(204);
    expect((await post({}, "/api/skipped")).status).toBe(400);

    await asked(post, "Third?");
    expect(requests.at(-1)?.question).toContain("may end this answer with one check question");
  });
});

describe("createAskHandler predict", () => {
  const primmStep = {
    ...saveStep,
    primm: {
      predict: "What does save return?",
      investigate: "Click the line that saves the clip.",
      target: saveStep.anchors[0] as (typeof saveStep.anchors)[number],
    },
  };
  const tour = "How are clips saved?";

  function providerWith(small: ProviderEvent[], afterStep?: () => Promise<void>): LLMProvider {
    return {
      async *ask(request) {
        requests.push(request);
        if (request.model === "small") {
          yield* small;
          return;
        }
        yield { type: "step", step: primmStep };
        await afterStep?.();
        yield { type: "done", usage };
      },
    };
  }

  const feedback: ProviderEvent[] = [
    { type: "text", text: "Close, it returns the id." },
    { type: "done", usage },
  ];

  async function startPredict(chosen: LLMProvider) {
    const started = await startAsk(true, chosen);
    await saveFrequentProfile(started.tutorRoot);

    return {
      tutorRoot: started.tutorRoot,
      ask: () => started.post({ question: tour }),
      predict: (body: object) => started.post(body, "/api/predict"),
    };
  }

  it("compares the prediction with the narration of the step of a finished tour", async () => {
    const { ask, predict } = await startPredict(providerWith(feedback));
    await (await ask()).text();

    const response = await predict({ tour, step: 0, prediction: "A boolean" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ feedback: "Close, it returns the id." });
    const small = requests.find((request) => request.model === "small");
    expect(small?.question).toContain("Clips are saved here.");
    expect(small?.question).toContain("A boolean");
  });

  it("logs the prediction check as a prediction call", async () => {
    const { ask, predict, tutorRoot } = await startPredict(providerWith(feedback));
    await (await ask()).text();

    await predict({ tour, step: 0, prediction: "A boolean" });

    const callTypes = await loggedCallTypes(tutorRoot);
    expect(callTypes).toEqual(["ask", "prediction"]);
  });

  it("finds the step of a tour that is still streaming", async () => {
    let finish = () => {};
    const held = providerWith(
      feedback,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { ask, predict } = await startPredict(held);
    const asking = ask();

    await vi.waitFor(async () => {
      expect((await predict({ tour, step: 0, prediction: "An id" })).status).toBe(200);
    });
    finish();
    await (await asking).text();
  });

  it("refuses a tour or a step that does not exist, and a malformed body", async () => {
    const { ask, predict } = await startPredict(providerWith(feedback));
    await (await ask()).text();

    expect((await predict({ tour: "Unknown", step: 0, prediction: "x" })).status).toBe(400);
    expect((await predict({ tour, step: 5, prediction: "x" })).status).toBe(400);
    expect((await predict({ tour, step: 0, prediction: "" })).status).toBe(400);
    expect((await predict({ tour, step: -1, prediction: "x" })).status).toBe(400);
  });

  it("refuses a step that carries no prediction prompt", async () => {
    const { ask, predict } = await startPredict({
      async *ask() {
        yield { type: "step", step: saveStep };
        yield { type: "done", usage };
      },
    });
    await (await ask()).text();

    expect((await predict({ tour, step: 0, prediction: "x" })).status).toBe(400);
  });

  it("answers an error the learner can read when the small model fails", async () => {
    const { ask, predict } = await startPredict(
      providerWith([{ type: "error", message: "Rate limited", retryable: true }]),
    );
    await (await ask()).text();

    const response = await predict({ tour, step: 0, prediction: "x" });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Rate limited" });
  });
});
