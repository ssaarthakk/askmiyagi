import { pathReplySchema } from "../shared/path.ts";
import { postJson } from "./played.ts";
import { responseError } from "./response-error.ts";

export async function fetchPath(token: string) {
  const response = await fetch("/api/path", { headers: { "x-miyagi-token": token } });
  if (!response.ok) throw await responseError(response, "Loading the learning path");
  return pathReplySchema.parse(await response.json());
}

export async function postPlan(token: string) {
  const response = await postJson("/api/path", {}, token, "Planning the learning path");
  return pathReplySchema.parse(await response.json());
}
