import type { Tour } from "../../shared/tour.ts";
import { wrapUntrusted } from "../../shared/untrusted.ts";
import { redact } from "../files/redact.ts";

const keptTurns = 3;

export function createConversation() {
  const turns: string[] = [];

  return {
    add(question: string, tour: Tour) {
      const titles = tour.steps.map((step) => step.title).join("; ");
      const check = tour.checkQuestion ? ` Check question: ${tour.checkQuestion}` : "";
      const record = wrapUntrusted("tour_record", redact(`Tour: ${titles}.${check}`));
      turns.push(`- Learner asked: ${redact(question)}\n  ${record}`);
      turns.splice(0, turns.length - keptTurns);
    },
    render() {
      if (turns.length === 0) return "";
      return ["Earlier in this conversation:", ...turns].join("\n");
    },
  };
}

export type Conversation = ReturnType<typeof createConversation>;
