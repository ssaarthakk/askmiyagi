import { symbolsSchema } from "../shared/symbols.ts";
import { responseError } from "./response-error.ts";

export async function fetchSymbols(token: string) {
  const response = await fetch("/api/symbols", { headers: { "x-miyagi-token": token } });
  if (!response.ok) throw await responseError(response, "Loading symbols");
  return symbolsSchema.parse(await response.json()).symbols;
}
