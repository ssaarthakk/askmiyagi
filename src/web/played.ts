import { responseError } from "./response-error.ts";

export async function postPlayed(tour: string, token: string) {
  const response = await fetch("/api/played", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ tour }),
  });
  if (!response.ok) throw await responseError(response, "Reporting the played tour");
}
