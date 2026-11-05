import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../../test/ask-helpers.ts";
import { key } from "../../../test/conversation-helpers.ts";
import {
  interviewProvider,
  interviewSession,
  planned,
  sixQuestions,
  storeDrill,
  unwrap,
} from "../../../test/interview-helpers.ts";
import { pathProject } from "../../../test/path-project.ts";
import type { PlannedQuestion } from "../../shared/interview.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { clearOverlay } from "../files/overlay.ts";
import { readRedactedFile } from "../files/path-guard.ts";

afterEach(() => {
  vi.useRealTimers();
  clearOverlay();
});

async function begin(questions: PlannedQuestion[] = sixQuestions, seen: LLMRequest[] = []) {
  const { root, session } = await interviewSession(interviewProvider({ questions, seen }));
  const started = unwrap(await session.start("realistic"));
  return { root, session, started };
}

async function skipTo(session: Awaited<ReturnType<typeof begin>>["session"], number: number) {
  for (let at = 1; at < number; at++) await session.answer("An answer.");
}

async function storeSource(root: string) {
  const read = await readRedactedFile(root, "src/store.ts");
  return read.ok ? read.value.source : read.error;
}

describe("a drill question", () => {
  it("shows the drilled copy to file reads only while the drill is the current question", async () => {
    const { root, session } = await begin();

    expect(await storeSource(root)).toBe("export const read = 1;");
    await skipTo(session, 5);
    expect(await storeSource(root)).toBe("export const read = 1;");
    const drill = await session.answer("An answer.");
    expect(drill.ok && drill.value.next?.kind).toBe("drill");
    expect(await storeSource(root)).toBe("export const read = 0;");
    await session.answer("An answer.");
    expect(await storeSource(root)).toBe("export const read = 1;");
  });

  it("clears the drilled copy when the interview is stopped", async () => {
    const { root, session } = await begin();
    await skipTo(session, 6);

    session.stop();

    expect(await storeSource(root)).toBe("export const read = 1;");
  });

  it("clears the drilled copy when a new interview starts", async () => {
    const { root, session } = await begin();
    await skipTo(session, 6);

    await session.start("friendly");

    expect(await storeSource(root)).toBe("export const read = 1;");
  });

  it("clears the drilled copy when the time is up", async () => {
    const { root, session } = await begin();
    await skipTo(session, 6);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 21 * 60 * 1000);

    await session.answer("Late.");

    expect(await storeSource(root)).toBe("export const read = 1;");
  });

  it("gives the interviewer the drilled code, and the real code on the other questions", async () => {
    const seen: LLMRequest[] = [];
    const { session } = await begin(sixQuestions, seen);

    await skipTo(session, 6);
    await session.answer("The change returns zero.");

    const turns = seen.filter((request) => !request.tools);
    expect(turns[0]?.question).toContain("1: export const read = 1;");
    expect(turns.at(-1)?.question).toContain("1: export const read = 0;");
    expect(turns.at(-1)?.question).not.toContain("read = 1");
  });

  it("keeps secrets in the model's replacement away from the interviewer and the files", async () => {
    const seen: LLMRequest[] = [];
    const leaky = {
      ...storeDrill,
      edits: [{ find: "export const read = 1;", replace: `export const read = "${key}";` }],
    };
    const { root, session } = await begin(
      [...sixQuestions.slice(0, 5), { ...planned("Breakage", "store", "drill"), drill: leaky }],
      seen,
    );
    await skipTo(session, 6);
    await session.answer("An answer.");

    expect(await storeSource(root)).not.toContain("sk-ant-");
    expect(JSON.stringify(seen)).not.toContain("sk-ant-api03");
  });

  it("never changes a file in the repo, during the drill or after it", async () => {
    const { root, session } = await begin();
    const hashes = async () =>
      Promise.all(
        Object.keys(pathProject).map(async (path) =>
          createHash("sha256")
            .update(await readFile(join(root, path)))
            .digest("hex"),
        ),
      );
    const before = await hashes();

    await skipTo(session, 6);
    expect(await hashes()).toEqual(before);
    await session.answer("An answer.");

    expect(await hashes()).toEqual(before);
  });
});

describe("dropping drills", () => {
  const drillOn = (drill: PlannedQuestion["drill"]) => ({
    ...planned("Breakage", "store", "drill"),
    drill,
  });
  const edit = (file: string, find: string) => ({ file, edits: [{ find, replace: "changed" }] });

  it.each([
    ["has no drill", drillOn(undefined)],
    ["finds text that is not in the file", drillOn(edit("src/store.ts", "export const gone"))],
    ["finds text that occurs twice", drillOn(edit("src/store.ts", "t"))],
    ["names a file that does not exist", drillOn(edit("src/nowhere.ts", "export"))],
    ["names a file outside the project", drillOn(edit("../outside.ts", "export"))],
    ["names a file other than the one it is anchored on", drillOn(edit("src/clip.ts", "clip"))],
  ])("drops a drill question that %s", async (_name, drill) => {
    terminal();
    const { started } = await begin([...sixQuestions.slice(0, 5), drill]);

    expect(started.total).toBe(5);
  });

  it("keeps the other questions when a drill is dropped", async () => {
    terminal();
    const { session } = await begin([
      ...sixQuestions.slice(0, 5),
      drillOn(edit("src/store.ts", "export const gone")),
    ]);

    const kinds: string[] = [];
    for (let at = 0; at < 4; at++) {
      const reply = await session.answer("An answer.");
      if (reply.ok && reply.value.next) kinds.push(reply.value.next.kind);
    }

    expect(kinds).toEqual(["explain", "explain", "explain", "why"]);
  });
});

describe("a Stop while the questions are planned", () => {
  it("keeps the interview stopped and the drill off when the plan arrives", async () => {
    let release: () => void = () => {};
    const planning = new Promise<void>((resolve) => (release = resolve));
    const drillFirst = interviewProvider({
      questions: [...sixQuestions.slice(5), ...sixQuestions.slice(0, 5)],
    });
    const { root, session } = await interviewSession({
      async *ask(request, signal) {
        await planning;
        yield* drillFirst.ask(request, signal);
      },
    });

    const starting = session.start("realistic");
    session.stop();
    release();

    expect(await starting).toMatchObject({ ok: false });
    expect(session.running).toBe(false);
    expect(await storeSource(root)).toBe("export const read = 1;");
  });
});
