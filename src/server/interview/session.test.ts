import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import {
  interviewProvider,
  interviewSession,
  planned,
  sixQuestions,
  unwrap,
} from "../../../test/interview-helpers.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { LLMProvider } from "../llm/provider.ts";

afterEach(() => {
  vi.useRealTimers();
});

async function start(provider: LLMProvider, weak: string[] = []) {
  return (await interviewSession(provider, weak)).session;
}

describe("starting an interview", () => {
  it("answers the first question with its number, kind and the highlighted lines", async () => {
    const session = await start(interviewProvider({}));

    const first = unwrap(await session.start("realistic"));

    expect(first).toEqual({
      endsAt: expect.any(Number),
      number: 1,
      total: 6,
      kind: "explain",
      concept: "Storage",
      question: "How does Storage work?",
      range: { file: "src/store.ts", start: 1, end: 1, capped: false },
    });
  });

  it("drops a question whose anchor does not resolve", async () => {
    const session = await start(
      interviewProvider({ questions: [planned("Gone", "missing"), ...sixQuestions.slice(0, 5)] }),
    );

    const first = unwrap(await session.start("realistic"));

    expect(first.total).toBe(5);
    expect(first.concept).toBe("Storage");
  });

  it("fails with a readable error when fewer than 4 questions are usable", async () => {
    terminal();
    const session = await start(
      interviewProvider({ questions: [...sixQuestions.slice(0, 3), planned("Gone", "missing")] }),
    );

    const result = await session.start("realistic");

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/3 usable questions/) });
    expect((await session.answer("Anything")).ok).toBe(false);
  });

  it.each([
    ["friendly", ["explain", "explain", "explain", "explain", "explain", "why"]],
    ["realistic", ["explain", "explain", "explain", "explain", "why", "drill"]],
    ["tough", ["explain", "explain", "why", "why", "drill", "drill"]],
  ] as const)("keeps the %s mix and drops questions over it", async (difficulty, kinds) => {
    const many = (["explain", "why", "drill"] as const).flatMap((kind) =>
      sixQuestions.map((question) => ({ ...question, kind })),
    );
    const session = await start(interviewProvider({ questions: many }));

    const first = unwrap(await session.start(difficulty));
    const seen = [first.kind];
    for (let number = 1; number < first.total; number++) {
      const answered = unwrap(await session.answer("An answer."));
      if (answered.next) seen.push(answered.next.kind);
    }

    expect(seen.sort()).toEqual([...kinds].sort());
  });

  it("puts questions on weak concepts first and tells the planner about them", async () => {
    const seen: LLMRequest[] = [];
    const session = await start(interviewProvider({ seen }), ["clips"]);

    const first = unwrap(await session.start("realistic"));

    expect(first.concept).toBe("Clips");
    expect(seen[0]?.question).toContain("clips");
  });

  it("gives the planner the repo map and the git log to work from", async () => {
    const seen: LLMRequest[] = [];
    const session = await start(interviewProvider({ seen }));

    await session.start("realistic");

    expect(seen[0]?.question).toContain("store.ts");
    expect(seen[0]?.question).toContain("No git history");
  });

  it("starting again replaces the running interview", async () => {
    const session = await start(interviewProvider({}));
    await session.start("realistic");
    await session.answer("An answer.");

    const again = unwrap(await session.start("friendly"));

    expect(again.number).toBe(1);
  });
});

describe("answering", () => {
  it("answers 'next' with the next question and the interviewer's words", async () => {
    const session = await start(
      interviewProvider({ turns: [{ action: "next", say: "Okay, thanks." }] }),
    );
    await session.start("realistic");

    const reply = unwrap(await session.answer("It reads a constant."));

    expect(reply).toMatchObject({ action: "next", say: "Okay, thanks.", finished: false });
    expect(reply.next).toMatchObject({ number: 2, concept: "Serving" });
  });

  it("refuses a second answer while the interviewer is still replying to the first", async () => {
    const session = await start(interviewProvider({}));
    await session.start("realistic");

    const [first, second] = await Promise.all([
      session.answer("First."),
      session.answer("Second."),
    ]);

    expect(unwrap(first).next?.number).toBe(2);
    expect(second).toEqual({ ok: false, error: expect.stringMatching(/still replying/) });
  });

  it("keeps the same question after a probe or a pushback", async () => {
    const session = await start(
      interviewProvider({
        turns: [
          { action: "probe", say: "Can you say more?" },
          { action: "pushback", say: "I am not convinced." },
        ],
      }),
    );
    await session.start("realistic");

    const probe = unwrap(await session.answer("It reads."));
    const pushback = unwrap(await session.answer("It reads a lot."));

    expect(probe).toMatchObject({ action: "probe", say: "Can you say more?", next: null });
    expect(pushback).toMatchObject({ action: "pushback", next: null, finished: false });
  });

  it.each([
    ["friendly", 1],
    ["realistic", 2],
    ["tough", 3],
  ] as const)(
    "moves on after %s's %i follow-ups, whatever the model says",
    async (difficulty, limit) => {
      const keepProbing = Array.from({ length: limit + 1 }, () => ({
        action: "probe",
        say: "More?",
      }));
      const session = await start(interviewProvider({ turns: keepProbing }));
      await session.start(difficulty);

      for (let probe = 0; probe < limit; probe++) {
        expect(unwrap(await session.answer("An answer."))).toMatchObject({ action: "probe" });
      }
      const forced = unwrap(await session.answer("An answer."));

      expect(forced).toMatchObject({ action: "next", say: "Let's move on." });
      expect(forced.next?.number).toBe(2);
    },
  );

  it("starts the next question with a fresh follow-up count", async () => {
    const turns = [
      { action: "probe", say: "More?" },
      { action: "next", say: "Okay." },
      { action: "probe", say: "More?" },
    ];
    const session = await start(interviewProvider({ turns }));
    await session.start("friendly");
    await session.answer("One.");
    await session.answer("Two.");

    expect(unwrap(await session.answer("Three."))).toMatchObject({ action: "probe" });
  });

  it("sends the question, its code, the answer and the follow-ups so far to the model", async () => {
    const seen: LLMRequest[] = [];
    const session = await start(
      interviewProvider({ seen, turns: [{ action: "probe", say: "What else?" }] }),
    );
    await session.start("realistic");
    await session.answer("It reads a constant.");

    await session.answer("And it is a stub.");

    const turns = seen.filter((request) => !request.tools);
    expect(turns[0]?.question).toContain("How does Storage work?");
    expect(turns[0]?.question).toContain("1: export const read = 1;");
    expect(turns[0]?.question).toContain("It reads a constant.");
    expect(turns[1]?.question).toContain("What else?");
    expect(turns[1]?.question).toContain("It reads a constant.");
    expect(turns[1]?.question).toContain("And it is a stub.");
    expect(turns[1]?.question).toContain("1 follow-ups left");
  });

  it("finishes after the last question", async () => {
    const session = await start(interviewProvider({}));
    const first = unwrap(await session.start("realistic"));

    let reply = unwrap(await session.answer("An answer."));
    for (let number = 2; number <= first.total; number++) {
      reply = unwrap(await session.answer("An answer."));
    }

    expect(reply).toMatchObject({ action: "next", next: null, finished: true });
    expect((await session.answer("More.")).ok).toBe(false);
  });

  it("says no interview is running before one starts and after it is stopped", async () => {
    const session = await start(interviewProvider({}));

    expect(await session.answer("An answer.")).toEqual({
      ok: false,
      error: "No interview is running. Start one first.",
    });
    await session.start("realistic");
    session.stop();
    expect((await session.answer("An answer.")).ok).toBe(false);
  });

  it("returns the model's error and keeps the question when the turn call fails", async () => {
    terminal();
    let failTurn = true;
    const working = interviewProvider({});
    const provider: LLMProvider = {
      async *ask(request, signal) {
        if (!request.tools && failTurn) {
          failTurn = false;
          yield { type: "error", message: "Rate limited", retryable: true };
          return;
        }
        yield* working.ask(request, signal);
      },
    };
    const session = await start(provider);
    await session.start("realistic");

    const failed = await session.answer("An answer.");
    const retried = unwrap(await session.answer("An answer."));

    expect(failed).toEqual({ ok: false, error: "Rate limited" });
    expect(retried.next?.number).toBe(2);
  });
});
