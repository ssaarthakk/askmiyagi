import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("no hints", () => {
  const modelAnswer = "Storage keeps one fixed number and hands it on unchanged.";

  async function sayWith(say: string) {
    const session = await start(interviewProvider({ turns: [{ action: "probe", say }] }));
    await session.start("realistic");
    return unwrap(await session.answer("It reads."));
  }

  it("replaces a say that quotes the model answer", async () => {
    const reply = await sayWith("Think about how it keeps one fixed number around.");

    expect(reply).toMatchObject({ action: "probe", say: "Can you say more?" });
  });

  it("replaces a say that quotes the anchored code", async () => {
    const reply = await sayWith("Is export const read 1 doing the work?");

    expect(reply).toMatchObject({ action: "probe", say: "Can you say more?" });
  });

  it("keeps a say that only shares single words with them", async () => {
    const reply = await sayWith("What does it keep, and for whom?");

    expect(reply.say).toBe("What does it keep, and for whom?");
  });

  it("never sends the model answer to the interviewer model or the page", async () => {
    const seen: LLMRequest[] = [];
    const session = await start(interviewProvider({ seen }));
    const first = unwrap(await session.start("realistic"));

    await session.answer("It reads.");

    expect(JSON.stringify(first)).not.toContain("fixed number");
    expect(seen.filter((request) => !request.tools)[0]?.question).not.toContain(modelAnswer);
  });

  it("replaces a say that quotes the code across a line break", async () => {
    const { root, session } = await interviewSession(
      interviewProvider({
        questions: [
          { ...planned("Short"), anchor: { file: "src/short.ts", symbol: "short" } },
          ...sixQuestions.slice(1),
        ],
        turns: [{ action: "probe", say: "So if ok return retry, then what?" }],
      }),
    );
    await writeFile(
      join(root, "src/short.ts"),
      "export function short(ok: boolean) {\n  if (ok)\n    return retry;\n}\nconst retry = 1;\n",
    );
    await session.start("realistic");

    expect(unwrap(await session.answer("It returns."))).toMatchObject({
      say: "Can you say more?",
    });
  });
});
