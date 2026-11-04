import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import { type Learner, learnerSchema } from "../../shared/learner.ts";
import { createLearnerRecord } from "./learner.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const retries = { name: "Upload retries", important: true, kind: "repo" } as const;
const promises = { name: "Promises", important: false, kind: "language" } as const;

async function stored(root: string) {
  const file = join(root, ".tutor", "private", "learner.json");
  return learnerSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

describe("createLearnerRecord", () => {
  it("adds a concept as seen with an empty rubric, no attempts and no review", async () => {
    const root = await tempDir();

    await createLearnerRecord(root).markSeen([retries, promises]);

    expect(await stored(root)).toEqual({
      concepts: [
        {
          name: "Upload retries",
          kind: "repo",
          important: true,
          state: "seen",
          rubric: null,
          attempts: 0,
          reviewsDone: 0,
          nextReview: null,
        },
        {
          name: "Promises",
          kind: "language",
          important: false,
          state: "seen",
          rubric: null,
          attempts: 0,
          reviewsDone: 0,
          nextReview: null,
        },
      ],
    });
  });

  it("moves a seen concept to explained, matching the name ignoring case", async () => {
    const root = await tempDir();
    const record = createLearnerRecord(root);
    await record.markSeen([retries]);

    await record.markExplained([{ ...retries, name: "upload RETRIES" }]);

    const { concepts } = await stored(root);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({ name: "Upload retries", state: "explained" });
  });

  it("adds a concept that is explained before it was seen", async () => {
    const root = await tempDir();

    await createLearnerRecord(root).markExplained([retries]);

    expect((await stored(root)).concepts).toMatchObject([
      { name: "Upload retries", state: "explained" },
    ]);
  });

  it("never moves a concept back, and keeps a concept important once it was", async () => {
    const root = await tempDir();
    const advanced: Learner = {
      concepts: [
        {
          name: "Upload retries",
          kind: "repo",
          important: false,
          state: "checked",
          rubric: "Retries use a cap.",
          attempts: 1,
          reviewsDone: 0,
          nextReview: "2030-01-02T00:00:00.000Z",
        },
      ],
    };
    await createLearnerRecord(root).markSeen([retries]);
    await writeFile(join(root, ".tutor", "private", "learner.json"), JSON.stringify(advanced));

    const record = createLearnerRecord(root);
    await record.markSeen([retries]);
    await record.markExplained([retries]);

    expect((await stored(root)).concepts).toEqual([{ ...advanced.concepts[0], important: true }]);
  });

  it("keeps every update when several arrive at once", async () => {
    const root = await tempDir();
    const record = createLearnerRecord(root);

    await Promise.all([
      record.markSeen([retries]),
      record.markSeen([promises]),
      record.markExplained([retries]),
    ]);

    expect((await stored(root)).concepts).toMatchObject([
      { name: "Upload retries", state: "explained" },
      { name: "Promises", state: "seen" },
    ]);
  });

  it("reports a corrupt learner.json once, moves it to learner.json.corrupt and starts again", async () => {
    const root = await tempDir();
    await createLearnerRecord(root).markSeen([promises]);
    const file = join(root, ".tutor", "private", "learner.json");
    await writeFile(file, '{"concepts":[{"name":"x"}]}');
    const output = terminal();

    await createLearnerRecord(root).markSeen([retries]);

    expect(output().match(/learner\.json is not valid/g)).toHaveLength(1);
    expect(await readdir(join(root, ".tutor", "private"))).toContain("learner.json.corrupt");
    expect((await stored(root)).concepts).toMatchObject([{ name: "Upload retries" }]);
  });

  it("leaves the record alone and says so when it cannot be read", async () => {
    const root = await tempDir();
    await createLearnerRecord(root).markSeen([promises]);
    const file = join(root, ".tutor", "private", "learner.json");
    await rm(file);
    await mkdir(file);
    const output = terminal();

    await createLearnerRecord(root).markSeen([retries]);

    expect(output()).toContain("learner.json not read");
    expect(output()).not.toContain("Learner record not saved");
    expect((await stat(file)).isDirectory()).toBe(true);
  });

  it("reports a store it cannot open instead of throwing", async () => {
    const root = await tempDir();
    await writeFile(join(root, ".tutor"), "not a folder");
    const output = terminal();

    await createLearnerRecord(root).markSeen([retries]);

    expect(output()).toContain("learner.json not read");
  });
});
