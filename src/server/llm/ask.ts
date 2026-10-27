import { basename } from "node:path";
import type { ResolvedAnchor, Selection } from "../../shared/anchor.ts";
import type { AskEvent } from "../../shared/events.ts";
import {
  findSymbolInputSchema,
  grepInputSchema,
  readFileInputSchema,
} from "../../shared/tool-inputs.ts";
import type { Step } from "../../shared/tour.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { buildRequest } from "./prompt.ts";
import type { LLMProvider } from "./provider.ts";
import { checkSelection } from "./selection.ts";

function progressText(name: string, input: unknown) {
  if (name === "read_file") {
    const parsed = readFileInputSchema.safeParse(input);
    return parsed.success ? `Looking at ${basename(parsed.data.path)}` : undefined;
  }
  if (name === "grep") {
    const parsed = grepInputSchema.safeParse(input);
    return parsed.success ? `Searching for ${parsed.data.patterns.join(" or ")}` : undefined;
  }
  if (name === "find_symbol") {
    const parsed = findSymbolInputSchema.safeParse(input);
    return parsed.success ? `Finding ${parsed.data.name}` : undefined;
  }
  return undefined;
}

export async function* askEvents(options: {
  root: string;
  provider: LLMProvider;
  question: string;
  ack: string;
  selection?: Selection | undefined;
  signal: AbortSignal;
  bruteForceTokens?: number | undefined;
}): AsyncGenerator<AskEvent> {
  const { root, signal } = options;
  yield { type: "ack", text: options.ack };

  const steps: Step[] = [];
  const allRanges: (ResolvedAnchor | null)[][] = [];
  let checkQuestion: string | undefined;
  try {
    let selection = options.selection;
    if (selection) {
      const checked = await checkSelection(root, selection);
      if (!checked.ok) {
        yield { type: "progress", text: `Ignoring the selection: ${checked.error}` };
        selection = undefined;
      }
    }
    const { request } = await buildRequest(
      root,
      options.question,
      options.bruteForceTokens,
      selection,
    );
    for await (const event of options.provider.ask(request, signal)) {
      if (signal.aborted) return;
      if (event.type === "tool_call") {
        const text = progressText(event.name, event.input);
        if (text !== undefined) yield { type: "progress", text };
      } else if (event.type === "step") {
        const ranges = await Promise.all(
          event.step.anchors.map(async (anchor) => {
            const resolved = await resolveAnchor(root, anchor);
            return resolved.ok ? resolved.value : null;
          }),
        );
        steps.push(event.step);
        allRanges.push(ranges);
        yield { type: "step", step: event.step, ranges };
      } else if (event.type === "checkQuestion") {
        checkQuestion = event.text;
      } else if (event.type === "text") {
        yield {
          type: "error",
          message: `The tutor answered with text that is not a step: ${event.text}`,
        };
        return;
      } else if (event.type === "error") {
        yield { type: "error", message: event.message };
        return;
      }
    }
  } catch (error) {
    yield { type: "error", message: error instanceof Error ? error.message : String(error) };
    return;
  }
  if (signal.aborted) return;

  yield {
    type: "tour",
    tour: {
      question: options.question,
      steps,
      ...(checkQuestion === undefined ? {} : { checkQuestion }),
    },
    ranges: allRanges,
  };
  yield { type: "done" };
}
