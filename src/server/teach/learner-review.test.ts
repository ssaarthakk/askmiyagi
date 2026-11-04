import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { learnerSchema } from "../../shared/learner.ts";
import { createLearnerRecord } from "./learner.ts";

const retries = { name: "Upload retries", important: true, kind: "repo" } as const;
const promises = { name: "Promises", important: true, kind: "language" } as const;
const start = new Date("2026-11-04T10:00:00.000Z");
const day = 86_400_000;

function inDays(days: number) {
  return new Date(start.getTime() + days * day);
}

async function stored(root: string) {
  const file = join(root, ".tutor", "private", "learner.json");
  return learnerSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

async function explained() {
  const root = await tempDir();
  const record = createLearnerRecord(root);
  await record.markExplained([retries]);
  return { root, record };
}

async function passedOnce() {
  const { root, record } = await explained();
  await record.grade("Upload retries", true, false, start);
  return { root, record };
}

describe("learner record rubrics", () => {
  it("keeps a rubric on the concept, matching the name ignoring case", async () => {
    const { root, record } = await explained();

    await record.setRubric("UPLOAD retries", "Says what is retried and the cap.");

    expect((await stored(root)).concepts[0]).toMatchObject({
      name: "Upload retries",
      rubric: "Says what is retried and the cap.",
    });
    expect((await record.concept("upload retries"))?.rubric).toBe(
      "Says what is retried and the cap.",
    );
  });

  it("does not add a concept when the rubric is for an unknown one", async () => {
    const { root, record } = await explained();

    await record.setRubric("Something else", "A rubric.");

    expect((await stored(root)).concepts).toHaveLength(1);
    expect(await record.concept("Something else")).toBeUndefined();
  });
});

describe("learner record grading", () => {
  it("checks a concept on a pass and schedules the first review after 1 day", async () => {
    const { root, record } = await explained();

    expect(await record.grade("Upload retries", true, false, start)).toBe("passed");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "checked",
      attempts: 0,
      reviewsDone: 0,
      nextReview: inDays(1).toISOString(),
    });
  });

  it("counts failed attempts and gives up on the third, scheduling a review after 1 day", async () => {
    const { root, record } = await explained();

    expect(await record.grade("Upload retries", false, false, start)).toBe("retry");
    expect(await record.grade("Upload retries", false, false, start)).toBe("retry");
    expect((await stored(root)).concepts[0]).toMatchObject({ attempts: 2, nextReview: null });
    expect(await record.grade("Upload retries", false, false, start)).toBe("gave-up");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "explained",
      attempts: 0,
      reviewsDone: 0,
      nextReview: inDays(1).toISOString(),
    });
  });

  it("checks a concept that gave up earlier when a later tour passes, not as a review", async () => {
    const { root, record } = await explained();
    await record.grade("Upload retries", false, false, start);
    await record.grade("Upload retries", false, false, start);
    await record.grade("Upload retries", false, false, start);

    expect(await record.grade("Upload retries", true, false, inDays(2))).toBe("passed");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "checked",
      attempts: 0,
      reviewsDone: 0,
      nextReview: inDays(3).toISOString(),
    });
  });

  it("returns undefined and writes nothing for a concept that is not in the record", async () => {
    const root = await tempDir();
    const record = createLearnerRecord(root);

    expect(await record.grade("Upload retries", true, false, start)).toBeUndefined();
    expect(await record.concept("Upload retries")).toBeUndefined();
  });

  it("moves a passed review to reviewed and schedules the next one after 3, then 7 days, then none", async () => {
    const { root, record } = await passedOnce();

    await record.grade("Upload retries", true, true, inDays(1));
    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "reviewed",
      reviewsDone: 1,
      nextReview: inDays(4).toISOString(),
    });

    await record.grade("Upload retries", true, true, inDays(4));
    expect((await stored(root)).concepts[0]).toMatchObject({
      reviewsDone: 2,
      nextReview: inDays(11).toISOString(),
    });

    await record.grade("Upload retries", true, true, inDays(11));
    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "reviewed",
      reviewsDone: 3,
      nextReview: null,
    });
  });

  it("moves a passed review of a concept that gave up earlier to reviewed", async () => {
    const { root, record } = await explained();
    await record.grade("Upload retries", false, false, start);
    await record.grade("Upload retries", false, false, start);
    await record.grade("Upload retries", false, false, start);

    expect(await record.grade("Upload retries", true, true, inDays(1))).toBe("passed");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "reviewed",
      attempts: 0,
      reviewsDone: 1,
      nextReview: inDays(4).toISOString(),
    });
  });

  it("starts the schedule again at 1 day when a review fails once", async () => {
    const { root, record } = await passedOnce();
    await record.grade("Upload retries", true, true, inDays(1));

    expect(await record.grade("Upload retries", false, true, inDays(4))).toBe("retry");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "reviewed",
      attempts: 1,
      reviewsDone: 0,
      nextReview: inDays(5).toISOString(),
    });
  });

  it("keeps the 1-day restart when a failed review passes on a retry", async () => {
    const { root, record } = await passedOnce();
    await record.grade("Upload retries", true, true, inDays(1));
    await record.grade("Upload retries", false, true, inDays(4));

    expect(await record.grade("Upload retries", true, true, inDays(4))).toBe("passed");

    expect((await stored(root)).concepts[0]).toMatchObject({
      attempts: 0,
      reviewsDone: 0,
      nextReview: inDays(5).toISOString(),
    });
  });

  it("goes on from the 1-day review after a failed review is skipped", async () => {
    const { root, record } = await passedOnce();
    await record.grade("Upload retries", true, true, inDays(1));
    await record.grade("Upload retries", false, true, inDays(4));
    await record.skipReview("Upload retries", inDays(4));

    await record.grade("Upload retries", true, true, inDays(5));

    expect((await stored(root)).concepts[0]).toMatchObject({
      reviewsDone: 1,
      nextReview: inDays(8).toISOString(),
    });
  });

  it("starts the schedule again at 1 day when a review fails three times", async () => {
    const { root, record } = await passedOnce();
    await record.grade("Upload retries", true, true, inDays(1));

    await record.grade("Upload retries", false, true, inDays(4));
    await record.grade("Upload retries", false, true, inDays(4));
    expect(await record.grade("Upload retries", false, true, inDays(4))).toBe("gave-up");

    expect((await stored(root)).concepts[0]).toMatchObject({
      state: "reviewed",
      reviewsDone: 0,
      attempts: 0,
      nextReview: inDays(5).toISOString(),
    });
  });
});

describe("learner record reviews", () => {
  it("lists the concepts whose review time has passed", async () => {
    const root = await tempDir();
    const record = createLearnerRecord(root);
    await record.markExplained([retries, promises]);
    await record.grade("Upload retries", true, false, start);

    expect(await record.dueReviews(inDays(0.5))).toEqual([]);
    expect(await record.dueReviews(inDays(1))).toEqual(["Upload retries"]);
    expect(await record.dueReviews(inDays(30))).toEqual(["Upload retries"]);
  });

  it("lists nothing when there is no record", async () => {
    expect(await createLearnerRecord(await tempDir()).dueReviews(start)).toEqual([]);
  });

  it("moves a skipped review 1 day after the skip", async () => {
    const { root, record } = await passedOnce();

    await record.skipReview("Upload retries", inDays(5));

    expect((await stored(root)).concepts[0]?.nextReview).toBe(inDays(6).toISOString());
    expect(await record.dueReviews(inDays(5))).toEqual([]);
    expect(await record.dueReviews(inDays(6))).toEqual(["Upload retries"]);
  });

  it("schedules nothing when a concept with no review is skipped", async () => {
    const { root, record } = await explained();

    await record.skipReview("Upload retries", start);

    expect((await stored(root)).concepts[0]?.nextReview).toBeNull();
  });

  it("forgets the failed attempts of an earlier explain-back", async () => {
    const { root, record } = await explained();
    await record.grade("Upload retries", false, false, start);
    await record.grade("Upload retries", false, false, start);

    await record.forgetAttempts("upload retries");

    expect((await stored(root)).concepts[0]?.attempts).toBe(0);
  });
});
