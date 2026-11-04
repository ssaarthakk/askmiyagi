import { dueReviewsSchema, explainBackReplySchema } from "../shared/learner.ts";
import { postJson } from "./played.ts";
import { responseError } from "./response-error.ts";

export async function postExplainBack(
  concept: string,
  answer: string,
  review: boolean,
  token: string,
) {
  const response = await postJson(
    "/api/explain-back",
    { concept, answer, review },
    token,
    "Grading the answer",
  );
  return explainBackReplySchema.parse(await response.json());
}

export async function postReviewSkipped(concept: string, token: string) {
  await postJson("/api/review-skipped", { concept }, token, "Skipping the review");
}

export async function fetchDue(token: string) {
  const response = await fetch("/api/reviews", { headers: { "x-miyagi-token": token } });
  if (!response.ok) throw await responseError(response, "Loading the reviews");
  return dueReviewsSchema.parse(await response.json()).due;
}
