import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanAskRoute,
  loggedCallTypes,
  requests,
  startAsk,
} from "../../../test/ask-route-harness.ts";
import {
  answer,
  concept,
  explainer,
  graded,
  gradeRequests,
  learnerReader,
  question,
  rubric,
  rubricSaved,
  start,
  tourProvider,
} from "../../../test/explain-back-harness.ts";
import { writeProfile } from "../teach/profile.ts";

afterEach(cleanAskRoute);

describe("rubric", () => {
  it("is written by the small model after a tour that keeps its question, and saved in the learner record", async () => {
    const { learner } = await start();

    await rubricSaved(learner);
    const request = requests.find((asked) => asked.model === "small");
    expect(request?.question).toContain("Clips are saved here.");
    expect(request?.question).toContain(concept);
  });

  it("is not written when the tour keeps no question", async () => {
    const { explain } = await start({ question: false });

    await explain({ concept, answer });
    expect(requests.filter((request) => request.model === "small")).toEqual([]);
  });

  it("is not written in answer mode", async () => {
    const started = await startAsk(true, tourProvider());
    await writeProfile(started.tutorRoot, {
      level: "intermediate",
      mode: "answer",
      frequency: "frequent",
      goal: null,
    });

    await (await started.post({ question })).text();

    await explainer(started.post)({ concept, answer });
    expect(requests.filter((request) => request.model === "small")).toEqual([]);
  });

  it("leaves the learner record without a rubric when the rubric cannot be written", async () => {
    const { learner } = await start({
      rubric: [{ type: "error", message: "Rate limited", retryable: true }],
    });

    await vi.waitFor(async () => expect((await learner()).concepts).toHaveLength(1));
    expect((await learner()).concepts[0]?.rubric).toBeNull();
  });
});

describe("POST /api/explain-back", () => {
  it("grades the answer against the rubric and the tour's code, and checks the concept on a pass", async () => {
    const { explain, learner } = await start({
      grades: [
        graded({
          score: 4,
          gaps: ["You did not say there is a cap."],
          anchors: [{ file: "src/clip-service.ts", symbol: "ClipService.save" }],
        }),
      ],
    });
    await rubricSaved(learner);

    const response = await explain({ concept: "upload RETRIES", answer });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "passed",
      score: 4,
      gaps: ["You did not say there is a cap."],
      ranges: [{ file: "src/clip-service.ts", start: 2, end: 4, capped: false }],
      modelAnswer: null,
    });
    const request = gradeRequests()[0];
    expect(request?.question).toContain(rubric);
    expect(request?.question).toContain(answer);
    expect(request?.question).toContain("return clip;");
    const saved = (await learner()).concepts[0];
    expect(saved).toMatchObject({ state: "checked", attempts: 0 });
    expect(saved?.nextReview).not.toBeNull();
  });

  it("grades an answer to the modify prompt against that prompt, and writes the rubric for it", async () => {
    const modify = "How would you change this to save the clip twice?";
    const { explain, learner } = await start({ checkQuestion: modify, primm: true });
    await rubricSaved(learner);

    await explain({ concept, answer: "Wrap the save in a loop that runs twice." });

    expect(requests.find((asked) => asked.model === "small")?.question).toContain(modify);
    expect(gradeRequests()[0]?.question).toContain(modify);
  });

  it("grades a review answer without the old tour question", async () => {
    const modify = "How would you change this to save the clip twice?";
    const { explain, learner } = await start({ checkQuestion: modify, primm: true });
    await rubricSaved(learner);

    await explain({ concept, answer, review: true });

    expect(gradeRequests()[0]?.question).not.toContain(modify);
  });

  it("logs the ask, the rubric and the grade as calls of their own types", async () => {
    const { explain, learner, tutorRoot } = await start();
    await rubricSaved(learner);

    await explain({ concept, answer });

    const callTypes = await loggedCallTypes(tutorRoot);
    expect(callTypes.toSorted()).toEqual(["ask", "grade", "rubric"]);
  });

  it("waits for a rubric that is still being written", async () => {
    let release = () => {};
    const { explain } = await start({
      rubricDelay: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });

    const grading = explain({ concept, answer });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gradeRequests()).toEqual([]);
    release();

    expect((await grading).status).toBe(200);
    expect(gradeRequests()[0]?.question).toContain(rubric);
  });

  it("asks for another try after a low score, then gives the model answer on the third failure", async () => {
    const low = graded({ score: 2, gaps: ["Say what is retried."] });
    const { explain, learner } = await start({ grades: [low, low, low] });
    await rubricSaved(learner);

    const first = await (await explain({ concept, answer })).json();
    const second = await (await explain({ concept, answer })).json();
    const third = await (await explain({ concept, answer })).json();

    expect(first).toMatchObject({ outcome: "retry", modelAnswer: null });
    expect(second).toMatchObject({ outcome: "retry", modelAnswer: null });
    expect(third).toMatchObject({ outcome: "gave-up", modelAnswer: "Retried up to three times." });
    const saved = (await learner()).concepts[0];
    expect(saved).toMatchObject({ state: "seen", attempts: 0 });
    expect(saved?.nextReview).not.toBeNull();
  });

  it("leaves out an anchor that does not resolve", async () => {
    const { explain } = await start({
      grades: [
        graded({
          score: 2,
          anchors: [
            { file: "src/missing.ts", symbol: "nothing" },
            { file: "../outside.ts", symbol: "x" },
          ],
        }),
      ],
    });

    const body = (await (await explain({ concept, answer })).json()) as { ranges: unknown[] };

    expect(body.ranges).toEqual([]);
  });

  it("refuses a concept that is not in the record and a malformed body", async () => {
    const { explain, learner } = await start();
    await rubricSaved(learner);

    const unknown = await explain({ concept: "Nothing", answer });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "That concept is not in your learner record" });
    expect((await explain({ concept })).status).toBe(400);
    expect((await explain({ concept, answer: "" })).status).toBe(400);
    expect((await explain({ concept, answer: "x".repeat(2001) })).status).toBe(400);
  });

  it("answers an error the learner can read when the grader fails, and leaves the record alone", async () => {
    const { explain, learner } = await start({ grades: ["Pretty good."] });
    await rubricSaved(learner);

    const response = await explain({ concept, answer });

    expect(response.status).toBe(502);
    expect((await learner()).concepts[0]).toMatchObject({ state: "seen", attempts: 0 });
  });

  it("grades by the stored rubric alone when the tour is not in this session", async () => {
    const { tutorRoot, post } = await startAsk(true, tourProvider());
    const privateDir = join(tutorRoot, ".tutor", "private");
    await mkdir(privateDir, { recursive: true });
    await writeFile(
      join(privateDir, "learner.json"),
      JSON.stringify({
        concepts: [
          {
            name: concept,
            kind: "repo",
            important: true,
            state: "checked",
            rubric,
            attempts: 0,
            reviewsDone: 0,
            nextReview: "2020-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const response = await post({ concept, answer, review: true }, "/api/explain-back");

    expect(response.status).toBe(200);
    expect(gradeRequests()[0]?.question).toContain(rubric);
    expect(gradeRequests()[0]?.question).not.toContain("return clip;");
    expect((await learnerReader(tutorRoot)()).concepts[0]).toMatchObject({
      state: "reviewed",
      reviewsDone: 1,
    });
  });
});
