import type { IncomingMessage, ServerResponse } from "node:http";
import type { CallRecord } from "../../shared/call-log.ts";
import { answerBodySchema, startBodySchema } from "../../shared/interview.ts";
import type { Result } from "../../shared/result.ts";
import { appendCallLog } from "../call-log.ts";
import { createInterviewSession, sessionConflicts } from "../interview/session.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { LearnerRecord } from "../teach/learner.ts";
import { readJsonBody, sendError, sendJson } from "./ask-route.ts";

function sendResult<T>(response: ServerResponse, result: Result<T>) {
  if (result.ok) sendJson(response, result.value);
  else sendError(response, sessionConflicts.includes(result.error) ? 409 : 502, result.error);
}

export function createInterviewHandler(options: {
  root: string;
  tutorRoot: string;
  provider: LLMProvider;
  providerName: string;
  learner: LearnerRecord;
}) {
  const session = createInterviewSession({
    root: options.root,
    provider: options.provider,
    callLog: {
      provider: options.providerName,
      write: (record: CallRecord) => appendCallLog(options.tutorRoot, record),
    },
    weakConcepts: options.learner.weakConcepts,
    markWeak: options.learner.markWeak,
  });

  async function start(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, startBodySchema);
    if (body) sendResult(response, await session.start(body.difficulty));
  }

  async function answer(request: IncomingMessage, response: ServerResponse) {
    const body = await readJsonBody(request, response, answerBodySchema);
    if (body) sendResult(response, await session.answer(body.answer));
  }

  return async function handleInterview(request: IncomingMessage, response: ServerResponse) {
    const pathname = request.url?.split("?", 1)[0];
    if (request.method === "DELETE") {
      session.stop();
      response.writeHead(204);
      response.end();
    } else if (pathname === "/api/interview/answer") {
      await answer(request, response);
    } else if (pathname === "/api/interview/debrief") {
      sendResult(response, await session.debrief());
    } else {
      await start(request, response);
    }
  };
}
