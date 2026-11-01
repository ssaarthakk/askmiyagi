import { afterEach, describe, expect, it, vi } from "vitest";
import { root, saveStep, scripted, terminal, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import type { ProviderEvent } from "../../shared/events.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { SessionRecord } from "../../shared/session.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";
import type { LLMProvider } from "./provider.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const finished: ProviderEvent[] = [
  { type: "step", step: saveStep },
  { type: "done", usage },
];

function ask(
  provider: LLMProvider,
  options: {
    conversation?: ReturnType<typeof createConversation>;
    signal?: AbortSignal;
    bruteForceTokens?: number;
    saveSession?: (session: SessionRecord) => Promise<void>;
  } = {},
) {
  return askEvents({
    root,
    provider,
    question: "How are clips saved?",
    ack: "One moment.",
    signal: options.signal ?? new AbortController().signal,
    conversation: options.conversation ?? createConversation(),
    bruteForceTokens: options.bruteForceTokens,
    saveSession: options.saveSession,
  });
}

describe("askEvents session record", () => {
  it("saves the session once after a finished ask, with the question and its record", async () => {
    const saved: SessionRecord[] = [];
    await collect(
      ask(scripted(finished), {
        saveSession: async (session) => {
          saved.push(session);
        },
      }),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]?.summary).toBeNull();
    expect(saved[0]?.turns).toEqual([
      { question: "How are clips saved?", record: "Tour: Saving a clip." },
    ]);
  });

  it("saves every turn of the conversation so far on the next finished ask", async () => {
    const conversation = createConversation();
    const saved: SessionRecord[] = [];
    const saveSession = async (session: SessionRecord) => {
      saved.push(session);
    };
    await collect(ask(scripted(finished), { conversation, saveSession }));
    await collect(ask(scripted(finished), { conversation, saveSession }));
    expect(saved.map((session) => session.turns.length)).toEqual([1, 2]);
    expect(saved[1]?.startedAt).toBe(saved[0]?.startedAt);
  });

  it("saves a plain reply's record", async () => {
    const saved: SessionRecord[] = [];
    await collect(
      ask(
        scripted([
          { type: "text", text: "That's fine." },
          { type: "done", usage },
        ]),
        { saveSession: async (session) => void saved.push(session) },
      ),
    );
    expect(saved[0]?.turns[0]?.record).toBe("Replied: That's fine.");
  });

  it("saves only after the done event has been sent, so it never delays the answer", async () => {
    const order: string[] = [];
    const events = ask(scripted(finished), {
      saveSession: async () => {
        order.push("saved");
      },
    });
    for await (const event of events) order.push(event.type);
    expect(order).toEqual(["ack", "step", "tour", "done", "saved"]);
  });

  it("saves nothing when the ask ends in an error", async () => {
    terminal();
    const saveSession = vi.fn(async () => {});
    await collect(
      ask(scripted([{ type: "error", message: "boom", retryable: false }]), { saveSession }),
    );
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("saves nothing when the ask is aborted", async () => {
    const controller = new AbortController();
    const provider: LLMProvider = {
      async *ask() {
        yield { type: "step", step: saveStep };
        controller.abort();
        yield { type: "done", usage };
      },
    };
    const saveSession = vi.fn(async () => {});
    await collect(ask(provider, { signal: controller.signal, saveSession }));
    expect(saveSession).not.toHaveBeenCalled();
  });
});

describe("askEvents mode re-check", () => {
  async function modes(bruteForceTokens: number | undefined, asks: number) {
    const conversation = createConversation();
    const seen: LLMRequest[] = [];
    const found: (string | null)[] = [];
    for (let count = 0; count < asks; count++) {
      const records: { mode: string | null }[] = [];
      await collect(
        askEvents({
          root,
          provider: scripted(finished, seen),
          question: "How are clips saved?",
          ack: "One moment.",
          signal: new AbortController().signal,
          conversation,
          bruteForceTokens,
          callLog: { provider: "fake", write: async (record) => void records.push(record) },
        }),
      );
      found.push(records[0]?.mode ?? null);
    }
    return { found, seen };
  }

  it("switches to agentic once the conversation no longer fits in the budget with the repo", async () => {
    const { seen } = await modes(undefined, 1);
    const repoCharacters = seen[0]?.context.length ?? 0;
    const tightBudget = Math.ceil(repoCharacters / 4);

    const { found } = await modes(tightBudget, 3);

    expect(found).toEqual(["brute-force", "agentic", "agentic"]);
  });

  it("stays in brute-force mode while repo and conversation fit", async () => {
    const { found } = await modes(undefined, 3);
    expect(found).toEqual(["brute-force", "brute-force", "brute-force"]);
  });
});
