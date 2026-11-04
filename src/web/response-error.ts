import { errorResponseSchema } from "../shared/file.ts";

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function responseError(response: Response, action: string) {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = errorResponseSchema.safeParse(body);
  return new Error(
    parsed.success ? parsed.data.error : `${action} failed with status ${response.status}`,
  );
}
