import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanAskRoute, startAsk } from "../../../test/ask-route-harness.ts";
import { answer, concept, graded, rubricSaved, start } from "../../../test/explain-back-harness.ts";

afterEach(cleanAskRoute);

describe("reviews", () => {
  async function dueConcept() {
    const started = await start();
    await rubricSaved(started.learner);
    await started.explain({ concept, answer });
    const stored = await started.learner();
    const [first] = stored.concepts;
    if (!first) throw new Error("no concept in the record");
    const file = join(started.tutorRoot, ".tutor", "private", "learner.json");
    const makeDue = () =>
      writeFile(
        file,
        JSON.stringify({ concepts: [{ ...first, nextReview: "2020-01-01T00:00:00.000Z" }] }),
      );
    return { ...started, makeDue };
  }

  it("lists the concepts whose review is due, and nothing before that", async () => {
    const { get, makeDue } = await dueConcept();
    expect(await (await get("/api/reviews")).json()).toEqual({ due: [] });

    await makeDue();

    expect(await (await get("/api/reviews")).json()).toEqual({ due: [concept] });
  });

  it("lists nothing for a learner with no record", async () => {
    const { get } = await startAsk(true);

    expect(await (await get("/api/reviews")).json()).toEqual({ due: [] });
  });

  it("moves a skipped review a day later", async () => {
    const { post, get, learner, makeDue } = await dueConcept();
    await makeDue();
    const before = Date.now();

    expect((await post({ concept }, "/api/review-skipped")).status).toBe(204);

    expect(await (await get("/api/reviews")).json()).toEqual({ due: [] });
    const next = (await learner()).concepts[0]?.nextReview;
    expect(Date.parse(next ?? "") - before).toBeGreaterThan(86_400_000 - 5000);
    expect((await post({}, "/api/review-skipped")).status).toBe(400);
  });

  it("starts the failed attempts again when a new tour asks about the concept", async () => {
    const low = graded({ score: 1 });
    const { post, learner, explain } = await start({ grades: [low, low, low] });
    await rubricSaved(learner);
    await explain({ concept, answer });
    await explain({ concept, answer });
    expect((await learner()).concepts[0]?.attempts).toBe(2);

    await (await post({ question: "And again?" })).text();
    await explain({ concept, answer });

    expect((await learner()).concepts[0]?.attempts).toBe(1);
  });
});
