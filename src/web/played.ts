import { responseError } from "./response-error.ts";

export async function postJson(path: string, body: object, token: string, action: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response, action);
  return response;
}

export async function postPlayed(tour: string, token: string) {
  await postJson("/api/played", { tour }, token, "Reporting the played tour");
}

export async function postSkipped(tour: string, token: string) {
  await postJson("/api/skipped", { tour }, token, "Reporting the skipped question");
}
