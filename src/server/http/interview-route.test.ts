import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import { loggedCallTypes } from "../../../test/ask-route-harness.ts";
import { interviewGrade, interviewProvider } from "../../../test/interview-helpers.ts";
import { listen, writePathProject } from "../../../test/path-project.ts";
import { tempDir } from "../../../test/temp-dir.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { createLearnerRecord } from "../teach/learner.ts";
import { createInterviewHandler } from "./interview-route.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function serve(provider: LLMProvider = interviewProvider({})) {
  const root = await writePathProject();
  const tutorRoot = await tempDir();
  const handler = createInterviewHandler({
    root,
    tutorRoot,
    provider,
    providerName: "fake",
    learner: createLearnerRecord(tutorRoot),
  });
  const base = await listen((request, response) => void handler(request, response));
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}/api/interview${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { tutorRoot, send };
}

describe("createInterviewHandler", () => {
  it("starts an interview at the chosen difficulty and answers the first question", async () => {
    const { send } = await serve();

    const response = await send("POST", "", { difficulty: "friendly" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ number: 1, total: 5, concept: "Storage" });
  });

  it("starts a realistic interview when no difficulty is given", async () => {
    const { send } = await serve();

    const response = await send("POST", "", {});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 6 });
  });

  it("rejects an unknown difficulty", async () => {
    const { send } = await serve();

    expect((await send("POST", "", { difficulty: "brutal" })).status).toBe(400);
  });

  it("answers an answer with the interviewer's reply", async () => {
    const { send } = await serve(
      interviewProvider({ turns: [{ action: "probe", say: "Can you say more?" }] }),
    );
    await send("POST", "", {});

    const response = await send("POST", "/answer", { answer: "It reads a constant." });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: "probe",
      say: "Can you say more?",
      next: null,
      finished: false,
    });
  });

  it("rejects an empty answer", async () => {
    const { send } = await serve();
    await send("POST", "", {});

    expect((await send("POST", "/answer", { answer: "  " })).status).toBe(400);
  });

  it("answers 409 when no interview is running", async () => {
    const { send } = await serve();

    const response = await send("POST", "/answer", { answer: "An answer." });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/start one/i) });
  });

  it("stops the interview", async () => {
    const { send } = await serve();
    await send("POST", "", {});

    const stopped = await send("DELETE", "");
    const answered = await send("POST", "/answer", { answer: "An answer." });

    expect(stopped.status).toBe(204);
    expect(answered.status).toBe(409);
  });

  it("answers 502 with the reason when the plan fails", async () => {
    terminal();
    const { send } = await serve(interviewProvider({ questions: [] }));

    const response = await send("POST", "", {});

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/usable/) });
  });

  it("logs the plan and the turn calls", async () => {
    const { send, tutorRoot } = await serve();
    await send("POST", "", {});
    await send("POST", "/answer", { answer: "An answer." });

    expect(await loggedCallTypes(tutorRoot)).toEqual(["interview-plan", "interview-turn"]);
  });
  describe("debrief", () => {
    async function finishInterview(send: Awaited<ReturnType<typeof serve>>["send"]) {
      await send("POST", "", {});
      for (let at = 0; at < 6; at++) await send("POST", "/answer", { answer: "An answer." });
    }

    it("answers the scorecard of a finished interview and logs the grade call", async () => {
      const { send, tutorRoot } = await serve();
      await finishInterview(send);

      const response = await send("POST", "/debrief");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        overall: 4,
        weak: [],
        questions: expect.arrayContaining([
          expect.objectContaining({
            number: 1,
            concept: "Storage",
            scores: expect.objectContaining({ accuracy: 4 }),
          }),
        ]),
      });
      expect((await loggedCallTypes(tutorRoot)).at(-1)).toBe("interview-grade");
    });

    it("saves a weak concept in the learner record", async () => {
      const gradings = [
        interviewGrade(1, [1, 2, 1, 2]),
        ...[2, 3, 4, 5, 6].map((n) => interviewGrade(n)),
      ];
      const { send, tutorRoot } = await serve(interviewProvider({ gradings: [gradings] }));
      await finishInterview(send);

      await send("POST", "/debrief");

      expect(await createLearnerRecord(tutorRoot).weakConcepts()).toEqual(["Storage"]);
    });

    it("answers 409 when no interview has finished", async () => {
      const { send } = await serve();
      await send("POST", "", {});

      const response = await send("POST", "/debrief");

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/finished/i) });
    });

    it("answers 502 with the reason when the grader fails, and lets the page try again", async () => {
      terminal();
      const { send } = await serve(interviewProvider({ gradings: [[interviewGrade(1)]] }));
      await finishInterview(send);

      const failed = await send("POST", "/debrief");
      const again = await send("POST", "/debrief");

      expect(failed.status).toBe(502);
      expect(await failed.json()).toMatchObject({ error: expect.stringMatching(/skipped/) });
      expect(again.status).toBe(200);
    });
  });
});
