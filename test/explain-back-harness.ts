import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, vi } from "vitest";
import type { LLMProvider } from "../src/server/llm/provider.ts";
import type { ProviderEvent } from "../src/shared/events.ts";
import { type Learner, learnerSchema } from "../src/shared/learner.ts";
import { saveStep, usage } from "./ask-helpers.ts";
import { requests, saveFrequentProfile, startAsk } from "./ask-route-harness.ts";

export const concept = "Upload retries";
export const question = "How are clips saved?";
export const answer = "It tries the upload again when it fails.";
export const rubric = "Says the upload is retried and capped.";

type Grade = { score: number; gaps?: string[]; anchors?: object[] };

export function graded({ score, gaps = [], anchors = [] }: Grade) {
  return JSON.stringify({ score, gaps, anchors, modelAnswer: "Retried up to three times." });
}

function text(value: string): ProviderEvent[] {
  return [
    { type: "text", text: value },
    { type: "done", usage },
  ];
}

export function tourProvider(
  options: {
    grades?: string[];
    rubric?: ProviderEvent[];
    rubricDelay?: Promise<void>;
    question?: boolean;
    checkQuestion?: string;
    primm?: boolean;
  } = {},
): LLMProvider {
  const grades = [...(options.grades ?? [])];
  return {
    async *ask(request) {
      requests.push(request);
      if (request.tools === false && request.model === "small") {
        await options.rubricDelay;
        yield* options.rubric ?? text(rubric);
        return;
      }
      if (request.tools === false) {
        yield* text(grades.shift() ?? graded({ score: 5 }));
        return;
      }
      const primm = {
        predict: "What is saved?",
        investigate: "Click the save.",
        target: { file: "src/clip-service.ts", symbol: "ClipService.save" },
      };
      yield { type: "step", step: options.primm ? { ...saveStep, primm } : saveStep };
      if (options.question !== false) {
        yield {
          type: "checkQuestion",
          text: options.checkQuestion ?? `Explain ${concept} back to me in your own words.`,
          concept,
        };
      }
      yield { type: "concepts", concepts: [{ name: concept, important: true, kind: "repo" }] };
      yield { type: "done", usage };
    },
  };
}

export function learnerReader(tutorRoot: string) {
  const file = join(tutorRoot, ".tutor", "private", "learner.json");
  return async () => learnerSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

export async function start(options: Parameters<typeof tourProvider>[0] = {}) {
  const started = await startAsk(true, tourProvider(options));
  await saveFrequentProfile(started.tutorRoot);
  const learner = learnerReader(started.tutorRoot);
  const explain = explainer(started.post);
  await (await started.post({ question })).text();
  return { ...started, learner, explain };
}

export function explainer(post: (body: object, path?: string) => Promise<Response>) {
  return (body: object) => post(body, "/api/explain-back");
}

export async function rubricSaved(learner: () => Promise<Learner>) {
  await vi.waitFor(async () => expect((await learner()).concepts[0]?.rubric).toBe(rubric));
}

export const gradeRequests = () =>
  requests.filter((request) => request.tools === false && request.model === "strong");
