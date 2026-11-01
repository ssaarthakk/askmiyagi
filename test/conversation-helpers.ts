import type { AgentMessage } from "../src/shared/agent-message.ts";
import type { Tour } from "../src/shared/tour.ts";

export const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

export function tour(titles: string[], checkQuestion?: string): Tour {
  return {
    question: "ignored",
    steps: titles.map((title) => ({
      title,
      anchors: [{ file: "a.ts", symbol: "a" }],
      narration: [{ text: `Narration of ${title}.` }],
    })),
    ...(checkQuestion === undefined ? {} : { checkQuestion }),
  };
}

export function turnMessages(number: number, tool = "read_file"): AgentMessage[] {
  const call = { id: `c${number}`, name: tool, input: { path: `file-${number}.ts` } };
  return [
    { role: "user", text: `Question ${number}` },
    { role: "assistant", text: `Looking ${number}`, toolCalls: [call] },
    {
      role: "tool",
      outputs: [
        {
          callId: call.id,
          name: tool,
          text: `<untrusted_content tool="${tool}">contents ${number}</untrusted_content>`,
          isError: false,
        },
      ],
    },
    { role: "assistant", text: `Answer ${number}`, toolCalls: [] },
  ];
}
