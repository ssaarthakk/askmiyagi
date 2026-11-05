import {
  answerReplySchema,
  type Difficulty,
  debriefReplySchema,
  type InterviewQuestion,
  startReplySchema,
} from "../shared/interview.ts";
import type { Highlight } from "./highlight.ts";
import { postJson } from "./played.ts";
import { responseError } from "./response-error.ts";

export function formatTimeLeft(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function interviewHighlight({
  kind,
  range,
}: Pick<InterviewQuestion, "kind" | "range">): Highlight {
  const shown = { file: range.file, current: range, previous: null };
  return kind === "drill" ? { ...shown, base: "drill" } : shown;
}

export async function startInterview(token: string, difficulty: Difficulty) {
  const response = await postJson(
    "/api/interview",
    { difficulty },
    token,
    "Starting the interview",
  );
  return startReplySchema.parse(await response.json());
}

export async function answerInterview(token: string, answer: string) {
  const response = await postJson("/api/interview/answer", { answer }, token, "Answering");
  return answerReplySchema.parse(await response.json());
}

export async function debriefInterview(token: string) {
  const response = await postJson("/api/interview/debrief", {}, token, "Grading the interview");
  return debriefReplySchema.parse(await response.json());
}

export async function stopInterview(token: string) {
  const response = await fetch("/api/interview", {
    method: "DELETE",
    keepalive: true,
    headers: { "x-miyagi-token": token },
  });
  if (!response.ok) throw await responseError(response, "Stopping the interview");
}
