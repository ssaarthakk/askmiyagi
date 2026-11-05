import { afterEach, describe, expect, it, vi } from "vitest";
import { interviewProvider, interviewSession, unwrap } from "../../../test/interview-helpers.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { LLMProvider } from "../llm/provider.ts";

afterEach(() => {
  vi.useRealTimers();
});

async function start(provider: LLMProvider, weak: string[] = []) {
  return (await interviewSession(provider, weak)).session;
}

describe("the timebox", () => {
  const twentyMinutes = 20 * 60 * 1000;

  it("tells the page when the 20 minutes end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const session = await start(interviewProvider({}));

    const first = unwrap(await session.start("realistic"));

    expect(first.endsAt).toBe(1_000_000 + twentyMinutes);
  });

  it("still takes an answer just before the time is up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = await start(interviewProvider({}));
    await session.start("realistic");
    vi.advanceTimersByTime(twentyMinutes - 1);

    const reply = unwrap(await session.answer("An answer."));

    expect(reply.finished).toBe(false);
    expect(reply.next?.number).toBe(2);
  });

  it("ends the interview with the answer that arrives after the time is up, with no follow-up call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const seen: LLMRequest[] = [];
    const session = await start(interviewProvider({ seen }));
    await session.start("realistic");
    const callsBefore = seen.length;
    vi.advanceTimersByTime(twentyMinutes);

    const reply = unwrap(await session.answer("My last answer."));

    expect(reply).toMatchObject({ action: "next", next: null, finished: true });
    expect(seen).toHaveLength(callsBefore);
    expect(session.running).toBe(false);
    expect((await session.answer("More.")).ok).toBe(false);
  });

  it("starting again begins a fresh 20 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = await start(interviewProvider({}));
    await session.start("realistic");
    vi.advanceTimersByTime(twentyMinutes);

    await session.start("realistic");

    expect(unwrap(await session.answer("An answer.")).finished).toBe(false);
  });
});
