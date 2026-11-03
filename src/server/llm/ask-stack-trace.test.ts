import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scripted, usage } from "../../../test/ask-helpers.ts";
import { collect } from "../../../test/fake-claude.ts";
import { createRepo } from "../../../test/git-helpers.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import { askEvents } from "./ask.ts";
import { createConversation } from "./conversation.ts";

async function run(question: string, seen: LLMRequest[]) {
  const conversation = createConversation();
  await collect(
    askEvents({
      root: await createRepo(),
      provider: scripted([{ type: "done", usage }], seen),
      conversation,
      question,
      ack: "One moment.",
      signal: new AbortController().signal,
    }),
  );
}

describe("askEvents with a pasted stack trace", () => {
  it("sends the model the parsed trace with Node and node_modules frames collapsed", async () => {
    const seen: LLMRequest[] = [];

    await run(
      `TypeError: x is undefined
    at getUser (/repo/src/users.ts:12:18)
    at Layer.handle (/repo/node_modules/express/lib/router/layer.js:95:5)
    at Module._compile (node:internal/modules/cjs/loader:1554:14)`,
      seen,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.question).toContain("TypeError: x is undefined");
    expect(seen[0]?.question).toContain("at getUser (/repo/src/users.ts:12:18)");
    expect(seen[0]?.question).toContain("... 2 frames from Node or node_modules collapsed");
    expect(seen[0]?.question).not.toContain("node:internal");
  });

  it("tells the model to run symptom, then trace back to where the bad value was created, then fix options", async () => {
    const seen: LLMRequest[] = [];

    await run(
      `TypeError: x is undefined
    at getUser (/repo/src/users.ts:12:18)
    at handler (/repo/src/users.ts:20:3)`,
      seen,
    );

    expect(seen[0]?.system).toMatch(/symptom[\s\S]*bad value was created[\s\S]*fix options/i);
    expect(seen[0]?.system).toMatch(/warning/i);
  });

  it("leaves an ordinary question as it is", async () => {
    const seen: LLMRequest[] = [];

    await run("what does at the end of the day mean here?", seen);

    expect(seen[0]?.question).toBe("what does at the end of the day mean here?");
    expect(seen[0]?.system).not.toMatch(/bad value was created/i);
  });

  it("anchors frames to project files and shows a warning when the function is not at the line", async () => {
    const root = await createRepo();
    await writeFile(
      join(root, "src", "users.ts"),
      "export function getUser() {\n  return 1;\n}\nexport function other() {\n  return 2;\n}\n",
    );
    const seen: LLMRequest[] = [];

    const events = await collect(
      askEvents({
        root,
        provider: scripted([{ type: "done", usage }], seen),
        conversation: createConversation(),
        question: `Error: x
    at getUser (/ci/app/src/users.ts:5:3)
    at other (/ci/app/src/users.ts:5:3)`,
        ack: "One moment.",
        signal: new AbortController().signal,
      }),
    );

    expect(seen[0]?.question).toContain(
      "at getUser (src/users.ts:5:3) [warning: getUser is not at src/users.ts:5]",
    );
    expect(seen[0]?.question).toContain("at other (src/users.ts:5:3)");
    expect(seen[0]?.question).not.toContain("other is not at");
    expect(events).toContainEqual({
      type: "progress",
      text: "Warning: getUser is not at src/users.ts:5",
    });
  });
});
