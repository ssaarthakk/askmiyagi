import { responseError } from "./response-error.ts";

async function reportTour(path: string, tour: string, token: string, action: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ tour }),
  });
  if (!response.ok) throw await responseError(response, action);
}

export const postPlayed = (tour: string, token: string) =>
  reportTour("/api/played", tour, token, "Reporting the played tour");

export const postSkipped = (tour: string, token: string) =>
  reportTour("/api/skipped", tour, token, "Reporting the skipped question");
