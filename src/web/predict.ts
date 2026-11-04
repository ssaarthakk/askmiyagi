import { z } from "zod";
import { responseError } from "./response-error.ts";

const predictionReplySchema = z.object({ feedback: z.string().min(1) });

export async function postPrediction(
  tour: string,
  step: number,
  prediction: string,
  token: string,
) {
  const response = await fetch("/api/predict", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ tour, step, prediction }),
  });
  if (!response.ok) throw await responseError(response, "Checking the prediction");
  return predictionReplySchema.parse(await response.json()).feedback;
}
