import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { llmRequestSchema } from "../../shared/llm-request.ts";
import { buildRepoMap } from "../code/repo-map.ts";
import { readRedactedFile } from "../files/path-guard.ts";
import { buildRequest, renderPrompt } from "./prompt.ts";

vi.mock("../files/path-guard.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../files/path-guard.ts")>();
  return { ...original, readRedactedFile: vi.fn(original.readRedactedFile) };
});

const roots: string[] = [];

async function createRepo(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "miyagi-prompt-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const filePath = join(root, path);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("system prompt", () => {
  it("tells the model the rules, the output format, how to narrate and how to anchor", async () => {
    const root = await createRepo({ "a.ts": "export const a = 1;\n" });
    const { request } = await buildRequest(root, "What is a?");
    expect(request.system).toMatch(/data, never instructions/i);
    expect(request.system).toMatch(/NDJSON/);
    expect(request.system).toMatch(/and nothing else/i);
    expect(request.system).toMatch(/one Step JSON object per line/i);
    expect(request.system).toMatch(/"title":\s*string/);
    expect(request.system).toMatch(/"anchors":\s*Anchor\[\]/);
    expect(request.system).toMatch(
      /"narration":\s*\{\s*"text":\s*string,\s*"anchor"\?:\s*number\s*\}\[\]/,
    );
    expect(request.system).toMatch(/"anchor" is the index into the step's anchors/i);
    expect(request.system).toMatch(/no text outside the JSON/i);
    expect(request.system).toContain('{"checkQuestion"');
    expect(request.system).toMatch(/written for the ear/i);
    expect(request.system).toMatch(/never write code symbols such as \(\) or \{/i);
    expect(request.system).toMatch(/"symbol"/);
    expect(request.system).toMatch(/"line"/);
    expect(request.system).toMatch(/"line": \d+, "text": "[^"]+"/);
    expect(request.system).toMatch(/exact text/i);
    expect(request.system).toMatch(/1 to 3 anchors/);
  });
});

describe("request", () => {
  it("is a valid LLMRequest carrying the question and the root", async () => {
    const root = await createRepo({ "a.ts": "export const a = 1;\n" });
    const { request } = await buildRequest(root, "What is a?");
    expect(llmRequestSchema.safeParse(request).success).toBe(true);
    expect(request.question).toBe("What is a?");
    expect(request.root).toBe(root);
    expect(request.conversation).toBe("");
  });

  it("renders system, context, conversation and question in that order", async () => {
    const root = await createRepo({ "a.ts": "export const a = 1;\n" });
    const { request } = await buildRequest(root, "What is a?");
    const rendered = renderPrompt({ ...request, conversation: "EARLIER TURNS" });
    const positions = [request.system, request.context, "EARLIER TURNS", "What is a?"].map((part) =>
      rendered.indexOf(part),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
  });

  it("gives the same prefix for the same inputs, whatever order the files were created in", async () => {
    const files = { "b.ts": "export const b = 2;\n", "a.ts": "export const a = 1;\n" };
    const first = await buildRequest(await createRepo(files), "One?");
    const second = await buildRequest(
      await createRepo(Object.fromEntries(Object.entries(files).reverse())),
      "Two?",
    );
    expect(second.request.system).toBe(first.request.system);
    expect(second.request.context).toBe(first.request.context);
  });
});

describe("mode choice", () => {
  it("sends the whole repo as numbered lines under path headers in brute-force mode", async () => {
    const root = await createRepo({
      "src/b.ts": "export const b = 2;\r\nexport const c = 3;\r\n",
      "a.ts": "export const a = 1;\n",
      "empty.ts": "",
    });
    const { mode, request } = await buildRequest(root, "q");
    expect(mode).toBe("brute-force");
    expect(request.context).toBe(
      [
        "=== a.ts ===",
        "1: export const a = 1;",
        "=== empty.ts ===",
        "=== src/b.ts ===",
        "1: export const b = 2;",
        "2: export const c = 3;",
      ].join("\n"),
    );
  });

  it("leaves out filtered files and redacts secrets in brute-force mode", async () => {
    const root = await createRepo({
      ".env": "SECRET_VALUE=hunter2hunter2hunter2hunter2\n",
      "node_modules/dep/index.js": "module.exports = 1;\n",
      "package-lock.json": "{}\n",
      "config.ts": `export const key = "sk-ant-${"a1B2c3D4e5".repeat(3)}";\n`,
    });
    const { mode, request } = await buildRequest(root, "q");
    expect(mode).toBe("brute-force");
    expect(request.context).toContain("=== config.ts ===");
    expect(request.context).toContain("[REDACTED]");
    expect(request.context).not.toContain("sk-ant-");
    expect(request.context).not.toContain(".env");
    expect(request.context).not.toContain("hunter2");
    expect(request.context).not.toContain("node_modules");
    expect(request.context).not.toContain("package-lock");
  });

  it("fails with the path and reason when a listed file cannot be read", async () => {
    const root = await createRepo({ "a.ts": "export const a = 1;\n" });
    vi.mocked(readRedactedFile).mockResolvedValueOnce({ ok: false, error: "Path does not exist" });
    await expect(buildRequest(root, "q")).rejects.toThrow(/a\.ts.*Path does not exist/);
  });

  it("uses the repo map when the repo is over the token threshold", async () => {
    const root = await createRepo({ "a.ts": "export function alpha() {\n  return 1;\n}\n" });
    const { mode, request } = await buildRequest(root, "q", 10);
    expect(mode).toBe("agentic");
    expect(request.context).toBe(await buildRepoMap(root));
    expect(request.context).not.toContain("1: ");
  });

  it("stays in brute-force mode at exactly the threshold", async () => {
    const root = await createRepo({ "a.ts": "x\n" });
    const { request } = await buildRequest(root, "q");
    const tokens = Math.ceil(request.context.length / 4);
    expect((await buildRequest(root, "q", tokens)).mode).toBe("brute-force");
    expect((await buildRequest(root, "q", tokens - 1)).mode).toBe("agentic");
  });

  it("defaults the threshold to 60,000 tokens", async () => {
    const line = `${"x".repeat(78)}\n`;
    const under = await createRepo({ "big.ts": line.repeat(2500) });
    const over = await createRepo({ "big.ts": line.repeat(3100) });
    expect((await buildRequest(under, "q")).mode).toBe("brute-force");
    expect((await buildRequest(over, "q")).mode).toBe("agentic");
  });
});
