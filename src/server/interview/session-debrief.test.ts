import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import {
  interviewAnchors,
  interviewGrade,
  interviewProvider,
  interviewSession,
  sixQuestions,
  unwrap,
} from "../../../test/interview-helpers.ts";
import type { Anchor } from "../../shared/anchor.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { clearOverlay } from "../files/overlay.ts";
import type { LLMProvider } from "../llm/provider.ts";

afterEach(() => {
  vi.useRealTimers();
  clearOverlay();
});

const twentyMinutes = 20 * 60 * 1000;

async function begin(provider: LLMProvider) {
  const interview = await interviewSession(provider);
  unwrap(await interview.session.start("realistic"));
  return interview;
}

async function finished(provider: LLMProvider, answers = 6) {
  const interview = await begin(provider);
  for (let at = 1; at <= answers; at++) unwrap(await interview.session.answer(`Answer ${at}.`));
  return interview;
}

function gradingRequest(seen: LLMRequest[]) {
  return seen.find((request) => request.system.includes("grading a mock interview"));
}

const storeAnchor = interviewAnchors.store as Anchor;
const missingAnchor = interviewAnchors.missing as Anchor;

const meanThreePointEight = [
  interviewGrade(1, [5, 4, 4, 4]),
  ...[2, 3, 4, 5, 6].map((number) => interviewGrade(number, [4, 4, 4, 3])),
];

describe("the debrief", () => {
  it("gives each question its four scores, gaps with the code, and the grader's model answer", async () => {
    const gradings = [
      interviewGrade(1, [5, 4, 4, 4], {
        gaps: ["You did not say what a missing file does."],
        anchors: [storeAnchor],
      }),
      ...meanThreePointEight.slice(1),
    ];
    const { session } = await finished(interviewProvider({ gradings: [gradings] }));

    const debrief = unwrap(await session.debrief());

    expect(debrief.questions).toHaveLength(6);
    expect(debrief.questions[0]).toEqual({
      number: 1,
      kind: "explain",
      concept: "Storage",
      question: "How does Storage work?",
      scores: { accuracy: 5, reasoning: 4, depth: 4, clarity: 4 },
      gaps: ["You did not say what a missing file does."],
      ranges: [{ file: "src/store.ts", start: 1, end: 1, capped: false }],
      modelAnswer: "A good answer to question 1.",
    });
  });

  it("scores the interview as the mean of every score, to one decimal", async () => {
    const { session } = await finished(interviewProvider({ gradings: [meanThreePointEight] }));

    expect(unwrap(await session.debrief()).overall).toBe(3.8);
  });

  it("gives the grader every exchange of every question, the probes included", async () => {
    const seen: LLMRequest[] = [];
    const { session } = await finished(
      interviewProvider({
        seen,
        turns: [
          { action: "probe", say: "What about errors?" },
          { action: "next", say: "Okay then." },
        ],
      }),
      7,
    );

    unwrap(await session.debrief());

    const text = gradingRequest(seen)?.question ?? "";
    const order = ["Answer 1.", "What about errors?", "Answer 2.", "Okay then.", "Answer 7."].map(
      (part) => text.indexOf(part),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("grades the code a drill question showed, which is the changed copy", async () => {
    const seen: LLMRequest[] = [];
    const { session } = await finished(interviewProvider({ seen }));

    unwrap(await session.debrief());

    expect(gradingRequest(seen)?.question).toContain("read = 0");
  });

  it("grades the answer that came after the time was up, and only the questions that were answered", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const seen: LLMRequest[] = [];
    const { session } = await begin(interviewProvider({ seen }));
    await session.answer("Before the end.");
    vi.advanceTimersByTime(twentyMinutes);
    const last = unwrap(await session.answer("My last answer."));

    const debrief = unwrap(await session.debrief());

    expect(last.finished).toBe(true);
    expect(debrief.questions.map(({ number }) => number)).toEqual([1, 2]);
    expect(gradingRequest(seen)?.question).toContain("My last answer.");
    expect(gradingRequest(seen)?.question).not.toContain("Question 3,");
  });

  it("drops a highlight whose anchor does not resolve and keeps the grade", async () => {
    terminal();
    const gradings = [
      interviewGrade(1, [4, 4, 4, 4], { gaps: ["A gap."], anchors: [missingAnchor] }),
      ...meanThreePointEight.slice(1),
    ];
    const { session } = await finished(interviewProvider({ gradings: [gradings] }));

    const debrief = unwrap(await session.debrief());

    expect(debrief.questions[0]).toMatchObject({ gaps: ["A gap."], ranges: [] });
  });
});

describe("weak topics", () => {
  const twoOnFirst = [
    interviewGrade(1, [2, 2, 2, 2]),
    interviewGrade(2, [2, 2, 2, 3]),
    ...[3, 4, 5, 6].map((number) => interviewGrade(number)),
  ];

  it("marks a concept weak when its question's mean is 2 or below, and not when it is above", async () => {
    const { session, weakMarks } = await finished(interviewProvider({ gradings: [twoOnFirst] }));

    const debrief = unwrap(await session.debrief());

    expect(weakMarks).toEqual([["Storage"]]);
    expect(debrief.weak).toEqual(["Storage"]);
  });

  it("lists a weak concept once when two of its questions were weak", async () => {
    const twice = sixQuestions.map((question, index) =>
      index === 1 ? { ...question, concept: "storage" } : question,
    );
    const gradings = [
      interviewGrade(1, [1, 1, 1, 1]),
      interviewGrade(2, [1, 1, 1, 1]),
      ...[3, 4, 5, 6].map((number) => interviewGrade(number)),
    ];
    const { session, weakMarks } = await finished(
      interviewProvider({ questions: twice, gradings: [gradings] }),
    );

    const debrief = unwrap(await session.debrief());

    expect(debrief.weak).toEqual(["Storage"]);
    expect(weakMarks).toEqual([["Storage"]]);
  });

  it("marks nothing weak when every question did well", async () => {
    const { session, weakMarks } = await finished(interviewProvider({}));

    expect(unwrap(await session.debrief()).weak).toEqual([]);
    expect(weakMarks.flat()).toEqual([]);
  });
});

describe("asking for a debrief at the wrong time", () => {
  const noDebrief = { ok: false, error: expect.stringMatching(/no finished interview/i) };

  it("fails before any interview", async () => {
    const { session } = await interviewSession(interviewProvider({}));

    expect(await session.debrief()).toEqual(noDebrief);
  });

  it("fails while the interview is still running", async () => {
    const { session } = await begin(interviewProvider({}));
    await session.answer("An answer.");

    expect(await session.debrief()).toEqual(noDebrief);
  });

  it("fails after Stop, because leaving ends the interview with no debrief", async () => {
    const { session } = await finished(interviewProvider({}));

    session.stop();

    expect(await session.debrief()).toEqual(noDebrief);
  });

  it("fails after a new interview has started", async () => {
    const { session } = await finished(interviewProvider({}));

    await session.start("friendly");

    expect(await session.debrief()).toEqual(noDebrief);
  });

  it("gives the debrief once, because it is not saved", async () => {
    const { session } = await finished(interviewProvider({}));
    unwrap(await session.debrief());

    expect(await session.debrief()).toEqual(noDebrief);
  });
});

describe("a grader that skips a question", () => {
  it("fails with the question number, keeps the interview for another try, and marks nothing weak", async () => {
    terminal();
    const missingSix = [1, 2, 3, 4, 5].map((number) => interviewGrade(number, [1, 1, 1, 1]));
    const { session, weakMarks } = await finished(interviewProvider({ gradings: [missingSix] }));

    const failed = await session.debrief();
    const again = await session.debrief();

    expect(failed).toEqual({ ok: false, error: expect.stringMatching(/question 6/i) });
    expect(weakMarks).toEqual([]);
    expect(again.ok).toBe(true);
  });
});
