import { basename } from "node:path";
import { z } from "zod";
import type { ResolvedAnchor, Selection } from "../../shared/anchor.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import type { AskEvent } from "../../shared/events.ts";
import {
  findSymbolInputSchema,
  grepInputSchema,
  readFileInputSchema,
} from "../../shared/tool-inputs.ts";
import type { Step } from "../../shared/tour.ts";
import type { Usage } from "../../shared/usage.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { logError } from "../log.ts";
import type { Conversation } from "./conversation.ts";
import { buildRequest } from "./prompt.ts";
import { type LLMProvider, lostThread } from "./provider.ts";
import { checkSelection } from "./selection.ts";

const openedFileSchema = z.object({ path: readFileInputSchema.shape.path });

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

type AskOptions = {
  root: string;
  provider: LLMProvider;
  conversation: Conversation;
  question: string;
  ack: string;
  selection?: Selection | undefined;
  signal: AbortSignal;
  bruteForceTokens?: number | undefined;
  callLog?: { provider: string; write(record: CallRecord): Promise<void> } | undefined;
};

type CallProgress = {
  mode: CallRecord["mode"];
  outcome: CallRecord["outcome"];
  ackMs: number;
  firstContentMs: number | null;
  usage: Usage;
  filesOpened: Set<string>;
};

const noUsage: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};

export async function* askEvents(options: AskOptions): AsyncGenerator<AskEvent> {
  const startedAt = new Date();
  const progress: CallProgress = {
    mode: null,
    outcome: "aborted",
    ackMs: 0,
    firstContentMs: null,
    usage: noUsage,
    filesOpened: new Set(),
  };
  try {
    yield* answer(options, progress, performance.now());
  } finally {
    await options.callLog?.write({
      callType: "ask",
      provider: options.callLog.provider,
      mode: progress.mode,
      startedAt: startedAt.toISOString(),
      ackMs: progress.ackMs,
      firstContentMs: progress.firstContentMs,
      ...progress.usage,
      filesOpened: [...progress.filesOpened],
      outcome: progress.outcome,
    });
  }
}

async function* answer(
  options: AskOptions,
  progress: CallProgress,
  started: number,
): AsyncGenerator<AskEvent> {
  const { root, signal } = options;
  yield { type: "ack", text: options.ack };
  progress.ackMs = performance.now() - started;

  const steps: Step[] = [];
  const allRanges: (ResolvedAnchor | null)[][] = [];
  let checkQuestion: string | undefined;
  const progressSent = new Set<string>();
  const replyLines: string[] = [];
  try {
    let selection = options.selection;
    if (selection) {
      const checked = await checkSelection(root, selection);
      if (!checked.ok) {
        yield { type: "progress", text: `Ignoring the selection: ${checked.error}` };
        selection = undefined;
      }
    }
    const { mode, request } = await buildRequest(
      root,
      options.question,
      options.bruteForceTokens,
      selection,
      options.conversation.render(),
    );
    progress.mode = mode;
    for await (const event of options.provider.ask(request, signal)) {
      if (signal.aborted) return;
      if (event.type === "tool_call") {
        const opened = openedFileSchema.safeParse(event.input);
        if (event.name === "read_file" && opened.success)
          progress.filesOpened.add(opened.data.path);
        const text = progressText(event.name, event.input);
        if (text !== undefined && !progressSent.has(text)) {
          progressSent.add(text);
          yield { type: "progress", text };
        }
      } else if (event.type === "step") {
        progress.firstContentMs ??= performance.now() - started;
        const ranges = await Promise.all(
          event.step.anchors.map(async (anchor) => {
            const resolved = await resolveAnchor(root, anchor);
            if (!resolved.ok) logError(`No highlight for ${anchor.file}: ${resolved.error}`);
            return resolved.ok ? resolved.value : null;
          }),
        );
        steps.push(event.step);
        allRanges.push(ranges);
        yield { type: "step", step: event.step, ranges };
      } else if (event.type === "checkQuestion") {
        checkQuestion = event.text;
      } else if (event.type === "text") {
        progress.firstContentMs ??= performance.now() - started;
        replyLines.push(event.text);
      } else if (event.type === "done") {
        progress.usage = event.usage;
      } else if (event.type === "error") {
        progress.outcome = "error";
        logError(`Ask failed: ${event.detail ?? event.message}`);
        yield { type: "error", message: event.message };
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.outcome = "error";
    logError(`Ask failed: ${message}`);
    yield { type: "error", message };
    return;
  }
  if (signal.aborted) return;

  if (steps.length > 0 && replyLines.length > 0) {
    logError(`Ignored text outside the steps: ${replyLines.join(" ")}`);
  }
  const reply = steps.length === 0 && replyLines.length > 0 ? replyLines.join(" ") : undefined;
  if (reply && (reply.length > 600 || replyLines.some((line) => /^\s*([{[]|```)/.test(line)))) {
    progress.outcome = "error";
    logError(`Ask failed: the tutor's reply was not plain speech: ${reply}`);
    yield { type: "error", message: lostThread };
    return;
  }
  const tour = {
    question: options.question,
    steps,
    ...(checkQuestion === undefined ? {} : { checkQuestion }),
    ...(reply === undefined ? {} : { reply }),
  };
  if (steps.length > 0 || reply) options.conversation.add(options.question, tour);
  progress.outcome = "done";
  yield { type: "tour", tour, ranges: allRanges };
  yield { type: "done" };
}
