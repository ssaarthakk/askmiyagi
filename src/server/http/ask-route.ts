import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { selectionSchema } from "../../shared/anchor.ts";
import type { CallRecord } from "../../shared/call-log.ts";
import { diffRequestSchema } from "../../shared/diff-base.ts";
import { intentSchema } from "../../shared/intent.ts";
import { conceptNameSchema, explainBackBodySchema, tourNameSchema } from "../../shared/learner.ts";
import { parseContract } from "../../shared/parse.ts";
import { ackPhrases } from "../../shared/phrases.ts";
import { currentSchema, type Step, stepAnchors } from "../../shared/tour.ts";
import { appendCallLog } from "../call-log.ts";
import { askEvents } from "../llm/ask.ts";
import { createConversation } from "../llm/conversation.ts";
import { createPredictor } from "../llm/predictor.ts";
import type { LLMProvider } from "../llm/provider.ts";
import { logError } from "../log.ts";
import { writeSessionRecord } from "../session-record.ts";
import { createExplainBack, unknownConcept } from "../teach/explain-back.ts";
import { createLearnerRecord } from "../teach/learner.ts";
import { readProfile } from "../teach/profile.ts";
import { createQuestionPolicy } from "../teach/question-policy.ts";
import type { createTourWatch } from "../tour-watch.ts";

const maxBodyBytes = 100_000;

const askBodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  selection: selectionSchema.optional(),
  current: currentSchema.optional(),
  diff: diffRequestSchema.optional(),
  intent: intentSchema.optional(),
  pathConcept: conceptNameSchema.shape.concept.optional(),
});

const predictBodySchema = z.object({
  ...tourNameSchema.shape,
  step: z.number().int().nonnegative(),
  prediction: z.string().trim().min(1).max(2000),
});

export function sendError(response: ServerResponse, status: number, message: string, reason = "") {
  logError(`${status} ${message}${reason && ` (${reason})`}`);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: message }));
}

export function sendJson(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function readBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += (chunk as Buffer).length;
    if (length <= maxBytes) chunks.push(chunk as Buffer);
  }
  return length > maxBytes ? undefined : Buffer.concat(chunks);
}

export async function readJsonBody<T>(
  request: IncomingMessage,
  response: ServerResponse,
  schema: z.ZodType<T>,
) {
  const raw = await readBody(request, maxBodyBytes);
  if (raw === undefined) {
    sendError(response, 400, "Request body is too large");
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    sendError(response, 400, "Request body is not valid JSON");
    return undefined;
  }
  const body = parseContract(schema, json);
  if (!body.ok) {
    sendError(response, 400, body.error);
    return undefined;
  }
  return body.value;
}

export function createAskHandler(options: {
  root: string;
  provider: LLMProvider;
  providerName: string;
  tutorRoot: string;
  bruteForceTokens?: number | undefined;
  contextTokens?: number | undefined;
  tourWatch?: ReturnType<typeof createTourWatch> | undefined;
}) {
  let running: { controller: AbortController; finished: Promise<void> } | undefined;
  let asked = 0;
  const conversation = createConversation({ contextTokens: options.contextTokens });
  const learner = createLearnerRecord(options.tutorRoot);
  const questionPolicy = createQuestionPolicy();
  const callLog = {
    provider: options.providerName,
    write: (record: CallRecord) => appendCallLog(options.tutorRoot, record),
  };
  const predictor = createPredictor(options.provider, options.root, callLog);
  const explainBack = createExplainBack({
    root: options.root,
    provider: options.provider,
    learner,
    conversation,
    callLog,
  });
  let streaming: { tour: string; steps: Step[] } = { tour: "", steps: [] };

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, askBodySchema);
    if (!body) return;
    if (running) {
      sendError(response, 409, "An ask is already running");
      return;
    }

    const controller = new AbortController();
    const finished = Promise.withResolvers<void>();
    running = { controller, finished: finished.promise };
    response.on("close", () => controller.abort());
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const ack = ackPhrases[asked++ % ackPhrases.length] ?? "";
    options.tourWatch?.start(body.diff?.base);
    streaming = { tour: body.question, steps: [] };
    try {
      for await (const event of askEvents({
        root: options.root,
        provider: options.provider,
        conversation,
        question: body.question,
        selection: body.selection,
        current: body.current,
        diff: body.diff,
        intent: body.intent,
        pathConcept: body.pathConcept,
        markSeen: learner.markSeen,
        questionPolicy,
        checkedConcepts: learner.checkedConcepts,
        startRubric: explainBack.startRubric,
        loadProfile: () => readProfile(options.tutorRoot),
        ack,
        signal: controller.signal,
        bruteForceTokens: options.bruteForceTokens,
        callLog,
        saveSession: (session) => writeSessionRecord(options.tutorRoot, session),
      })) {
        if (event.type === "step") {
          streaming.steps.push(event.step);
          options.tourWatch?.addStep(stepAnchors(event.step), event.ranges);
        }
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      running = undefined;
      finished.resolve();
      response.end();
    }
  }

  async function played(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, tourNameSchema);
    if (!body) return;
    response.writeHead(204);
    response.end();
    const concepts = conversation.turnAsked(body.tour)?.tour.concepts;
    if (concepts) await learner.markExplained(concepts);
  }

  async function skipped(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, tourNameSchema);
    if (!body) return;
    response.writeHead(204);
    response.end();
    const tour = conversation.turnAsked(body.tour)?.tour;
    if (!tour?.checkQuestion) return;
    questionPolicy.skipped();
  }

  async function explainBackAnswer(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, explainBackBodySchema);
    if (!body) return;
    const result = await explainBack.grade(body.concept, body.answer, body.review);
    if (!result.ok) {
      sendError(response, result.error === unknownConcept ? 400 : 502, result.error);
      return;
    }
    sendJson(response, result.value);
  }

  async function reviews(response: ServerResponse) {
    sendJson(response, { due: await learner.dueReviews() });
  }

  async function reviewSkipped(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, conceptNameSchema);
    if (!body) return;
    response.writeHead(204);
    response.end();
    await learner.skipReview(body.concept);
  }

  async function predict(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, predictBodySchema);
    if (!body) return;
    const steps =
      streaming.tour === body.tour
        ? streaming.steps
        : conversation.turnAsked(body.tour)?.tour.steps;
    const step = steps?.[body.step];
    if (!step?.primm) {
      sendError(response, 400, "That step has nothing to predict");
      return;
    }
    const result = await predictor({
      predict: step.primm.predict,
      narration: step.narration.map((part) => part.text),
      prediction: body.prediction,
    });
    if (!result.ok) {
      sendError(response, 502, result.error);
      return;
    }
    sendJson(response, { feedback: result.value });
  }

  async function interrupt() {
    running?.controller.abort();
    await running?.finished;
  }

  return {
    handle,
    learner,
    played,
    skipped,
    predict,
    explainBack: explainBackAnswer,
    reviews,
    reviewSkipped,
    interrupt,
  };
}
