import { fileResponseSchema } from "../shared/file.ts";
import { responseError } from "./response-error.ts";

export async function fetchFile(path: string, token: string) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    headers: { "x-miyagi-token": token },
  });
  if (!response.ok) throw await responseError(response, "Loading the file");
  return fileResponseSchema.parse(await response.json()).content;
}
