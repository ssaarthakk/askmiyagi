import type { AgentMessage } from "../../shared/agent-message.ts";
import type { ResolvedAnchor, Selection } from "../../shared/anchor.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import type { DiffRequest } from "../../shared/diff-base.ts";
import type { AskEvent } from "../../shared/events.ts";
import type { Intent } from "../../shared/intent.ts";
import type { TourConcept } from "../../shared/learner.ts";
import type { LLMRequest } from "../../shared/llm-request.ts";
import type { Profile } from "../../shared/profile.ts";
import type { SessionRecord } from "../../shared/session.ts";
import type { Current, Step, Tour } from "../../shared/tour.ts";
import { addUsage, noUsage, type Usage } from "../../shared/usage.ts";
import { resolveAnchor } from "../code/anchor-resolver.ts";
import { logError } from "../log.ts";
import { profileContext } from "../teach/profile.ts";
import { openedFileSchema, progressText, retryQuestion } from "./ask-progress.ts";
import type { Conversation } from "./conversation.ts";
import { buildDiffContext, diffRules } from "./diff-context.ts";
import { describePosition } from "./position.ts";
import { answerModeRules, buildRequest } from "./prompt.ts";
import { type LLMProvider, lostThread } from "./provider.ts";
import { checkSelection } from "./selection.ts";
import {
  anchorStackTrace,
  formatStackTrace,
  parseStackTrace,
  stackTraceRules,
  stackTraceWarnings,
} from "./stack-trace.ts";
import { createSummariser } from "./summariser.ts";

type AskOptions = {
  root: string;
  provider: LLMProvider;
  conversation: Conversation;
  question: string;
  ack: string;
  selection?: Selection | undefined;
  current?: Current | undefined;
  diff?: DiffRequest | undefined;
  loadProfile?: (() => Promise<Profile | null>) | undefined;
  mode?: Profile["mode"] | undefined;
  intent?: Intent | undefined;
  markSeen?: ((concepts: TourConcept[]) => Promise<void>) | undefined;
  signal: AbortSignal;
  bruteForceTokens?: number | undefined;
  callLog?: { provider: string; write(record: CallRecord): Promise<void> } | undefined;
  saveSession?: ((session: SessionRecord) => Promise<void>) | undefined;
};

type CallProgress = {
  mode: CallRecord["mode"];
  outcome: CallRecord["outcome"];
  ackMs: number;
  firstContentMs: number | null;
  usage: Usage;
  filesOpened: Set<string>;
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
    if (progress.outcome === "done") await options.saveSession?.(options.conversation.session());
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
  let answerMode = false;
  let scope: Tour["scope"];
  let intent = options.intent;
  let concepts: TourConcept[] | undefined;
  let turnMessages: AgentMessage[] | undefined;
  let contextLength = 0;
  const progressSent = new Set<string>();
  const replyLines: string[] = [];
  const keepPartialTour = () => {
    if (steps.length > 0) {
      options.conversation.add(
        options.question,
        { question: options.question, steps },
        [],
        options.diff?.base,
      );
    }
  };
  try {
    let selection = options.selection;
    if (selection) {
      const checked = await checkSelection(root, selection);
      if (!checked.ok) {
        yield { type: "progress", text: `Ignoring the selection: ${checked.error}` };
        selection = undefined;
      }
    }
    const diffContext = options.diff && (await buildDiffContext(root, options.diff));
    if (diffContext && !diffContext.ok) {
      progress.outcome = "error";
      logError(`Ask failed: ${diffContext.error}`);
      yield { type: "error", message: diffContext.error };
      return;
    }
    const parsedTrace = parseStackTrace(options.question);
    const trace = parsedTrace && (await anchorStackTrace(root, parsedTrace));
    for (const warning of trace ? stackTraceWarnings(trace) : []) {
      yield { type: "progress", text: `Warning: ${warning}` };
    }
    const profile = await options.loadProfile?.();
    answerMode = (options.mode ?? profile?.mode) === "answer";
    const built = await buildRequest(
      root,
      trace ? formatStackTrace(trace) : options.question,
      options.bruteForceTokens,
      selection,
      options.conversation.size(),
    );
    contextLength = built.request.context.length;
    const earlier = options.current && options.conversation.turnAsked(options.current.tour);
    const position =
      options.current &&
      earlier &&
      (await describePosition(root, earlier.tour, options.current, earlier.base));
    const request: LLMRequest = {
      ...built.request,
      system: [
        built.request.system,
        answerMode && answerModeRules,
        diffContext && diffRules,
        trace && stackTraceRules,
      ]
        .filter(Boolean)
        .join("\n\n"),
      question: [
        built.request.question,
        profile && profileContext(profile),
        options.intent && `The learner chose the intent "${options.intent}" for this question.`,
        diffContext?.value,
        position,
      ]
        .filter(Boolean)
        .join("\n\n"),
      conversation: options.conversation.render(),
      history: options.conversation.messages(contextLength),
    };
    progress.mode = built.mode;
    let attempt = request;
    let retried = false;
    const attemptsStartedAt = Date.now();
    while (true) {
      let invalidStepErrors: string | undefined;
      for await (const event of options.provider.ask(attempt, signal)) {
        if (signal.aborted) {
          keepPartialTour();
          return;
        }
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
              const resolved = await resolveAnchor(root, anchor, options.diff?.base);
              if (!resolved.ok) logError(`No highlight for ${anchor.file}: ${resolved.error}`);
              return resolved.ok ? resolved.value : null;
            }),
          );
          steps.push(event.step);
          allRanges.push(ranges);
          yield { type: "step", step: event.step, ranges };
        } else if (event.type === "checkQuestion") {
          checkQuestion = event.text;
        } else if (event.type === "scope") {
          scope = event.scope;
        } else if (event.type === "intent") {
          intent ??= event.intent;
        } else if (event.type === "concepts") {
          concepts = event.concepts;
        } else if (event.type === "text") {
          progress.firstContentMs ??= performance.now() - started;
          replyLines.push(event.text);
        } else if (event.type === "done") {
          progress.usage = addUsage(progress.usage, event.usage);
          turnMessages = event.messages;
        } else if (event.type === "error") {
          if (event.usage) progress.usage = addUsage(progress.usage, event.usage);
          if (event.invalidStep && !retried) {
            invalidStepErrors = event.detail ?? event.message;
            logError(`Retrying from step ${steps.length + 1}: ${invalidStepErrors}`);
            break;
          }
          progress.outcome = "error";
          logError(`Ask failed: ${event.detail ?? event.message}`);
          yield { type: "error", message: event.message };
          return;
        }
      }
      if (invalidStepErrors === undefined) break;
      retried = true;
      attempt = {
        ...request,
        question: retryQuestion(request.question, steps, invalidStepErrors),
        spent: progress.usage,
        startedAt: attemptsStartedAt,
      };
    }
  } catch (error) {
    if (signal.aborted) {
      keepPartialTour();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    progress.outcome = "error";
    logError(`Ask failed: ${message}`);
    yield { type: "error", message };
    return;
  }
  if (signal.aborted) {
    keepPartialTour();
    return;
  }

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
    ...(checkQuestion === undefined || answerMode ? {} : { checkQuestion }),
    ...(reply === undefined ? {} : { reply }),
    ...(scope === undefined ? {} : { scope }),
    ...(intent === undefined ? {} : { intent }),
    ...(concepts === undefined ? {} : { concepts }),
  };
  if (steps.length > 0 || reply) {
    options.conversation.add(options.question, tour, turnMessages, options.diff?.base);
    void options.conversation.summarise(contextLength, createSummariser(options.provider, root));
  }
  progress.outcome = "done";
  if (concepts?.length) void options.markSeen?.(concepts);
  yield { type: "tour", tour, ranges: allRanges };
  yield { type: "done" };
}
