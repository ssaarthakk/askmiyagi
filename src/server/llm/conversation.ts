import type { AgentMessage } from "../../shared/agent-message.ts";
import type { DiffBase } from "../../shared/diff-base.ts";
import type { SessionRecord } from "../../shared/session.ts";
import type { Tour } from "../../shared/tour.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";
import { logError } from "../log.ts";
import { charactersPerToken } from "./prompt.ts";
import type { Summariser } from "./summariser.ts";

const fullTurns = 3;
const defaultContextTokens = 200_000;
const placeholderShare = 0.5;
const summaryShare = 0.7;

type Turn = {
  question: string;
  tour: Tour;
  record: string;
  answer: string;
  messages: AgentMessage[];
  base: DiffBase | undefined;
};

function recordOf(tour: Tour) {
  if (tour.reply) return `Replied: ${tour.reply}`;
  const titles = tour.steps.map((step) => step.title).join("; ");
  const check = tour.checkQuestion ? ` Check question: ${tour.checkQuestion}` : "";
  return `Tour: ${titles}.${check}`;
}

function answerOf(tour: Tour) {
  if (tour.reply) return tour.reply;
  const lines = tour.steps.map((step) => JSON.stringify(step));
  if (tour.checkQuestion) lines.push(JSON.stringify({ checkQuestion: tour.checkQuestion }));
  if (tour.scope || tour.intent) {
    lines.push(
      JSON.stringify({
        ...(tour.scope && { scope: tour.scope }),
        ...(tour.intent && { intent: tour.intent }),
      }),
    );
  }
  return lines.join("\n");
}

function redactMessage(message: AgentMessage): AgentMessage {
  return message.role === "tool" ? message : { ...message, text: redact(message.text) };
}

function withoutToolResults(message: AgentMessage): AgentMessage {
  if (message.role !== "tool") return message;
  const outputs = message.outputs.map((output) => ({
    ...output,
    text: `[${output.name} result removed]`,
  }));
  return { ...message, outputs };
}

function summaryMessages(summary: string): AgentMessage[] {
  return [
    {
      role: "user",
      text: `Summary of the earlier conversation:
${wrapUntrusted("conversation_summary", summary)}`,
    },
    { role: "assistant", text: "Understood.", toolCalls: [] },
  ];
}

export function createConversation({
  contextTokens = defaultContextTokens,
}: {
  contextTokens?: number | undefined;
} = {}) {
  const startedAt = new Date().toISOString();
  const turns: Turn[] = [];
  let summary: string | null = null;
  let summarising = false;

  function render() {
    if (turns.length === 0) return "";
    const lines = turns.map((turn, index) => {
      const body =
        index >= turns.length - fullTurns
          ? wrapUntrusted("tour_answer", turn.answer)
          : wrapUntrusted("tour_record", turn.record);
      return `- Learner asked: ${turn.question}\n  ${body}`;
    });
    const earlier =
      summary === null ? [] : [`- Summary: ${wrapUntrusted("conversation_summary", summary)}`];
    return ["Earlier in this conversation:", ...earlier, ...lines].join("\n");
  }

  function allMessages() {
    return [
      ...(summary === null ? [] : summaryMessages(summary)),
      ...turns.flatMap((turn) => turn.messages),
    ];
  }

  function size() {
    return turns.length === 0 ? 0 : Math.max(render().length, JSON.stringify(allMessages()).length);
  }

  function contextTokensUsed(contextCharacters: number) {
    return (contextCharacters + size()) / charactersPerToken;
  }

  function summaryInput(count: number) {
    const earlier = turns
      .slice(0, count)
      .map((turn) => `Learner asked: ${turn.question}\nTutor answered: ${turn.answer}`);
    return [...(summary === null ? [] : [`Summary so far: ${summary}`]), ...earlier].join("\n\n");
  }

  async function summarise(contextCharacters: number, summariser: Summariser) {
    if (
      summarising ||
      turns.length <= fullTurns ||
      contextTokensUsed(contextCharacters) <= contextTokens * summaryShare
    ) {
      return;
    }
    summarising = true;
    const count = turns.length - fullTurns;
    try {
      const result = await summariser(summaryInput(count));
      if (!result.ok) throw new Error(result.error);
      turns.splice(0, count);
      summary = redact(result.value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logError(`Could not summarise the conversation: ${reason}`);
    } finally {
      summarising = false;
    }
  }

  return {
    add(question: string, tour: Tour, messages: AgentMessage[] = [], base?: DiffBase) {
      turns.push({
        question: redact(question),
        tour,
        record: redact(recordOf(tour)),
        answer: redact(answerOf(tour)),
        messages: messages.map(redactMessage),
        base,
      });
    },
    turnAsked(question: string) {
      const turn = turns.findLast((asked) => asked.question === redact(question));
      return turn && { tour: turn.tour, base: turn.base };
    },
    render,
    size,
    session(): SessionRecord {
      return {
        startedAt,
        summary,
        turns: turns.map(({ question, record }) => ({ question, record })),
      };
    },
    messages(contextCharacters: number) {
      if (contextTokensUsed(contextCharacters) > contextTokens * placeholderShare) {
        for (const turn of turns.slice(0, -fullTurns)) {
          turn.messages = turn.messages.map(withoutToolResults);
        }
      }
      return allMessages();
    },
    summarise,
  };
}

export type Conversation = ReturnType<typeof createConversation>;
