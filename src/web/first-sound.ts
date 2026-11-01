import { responseError } from "./response-error.ts";

export async function postFirstSound(ms: number, token: string) {
  const response = await fetch("/api/first-sound", {
    method: "POST",
    headers: { "content-type": "application/json", "x-miyagi-token": token },
    body: JSON.stringify({ ms }),
  });
  if (!response.ok) throw await responseError(response, "Logging the first sound");
}

export function createFirstSound(report: (ms: number) => Promise<void>) {
  let askedAt: number | undefined;
  let soundMs: number | undefined;
  let answered = false;

  function reportWhenReady() {
    if (soundMs === undefined || !answered) return;
    const ms = soundMs;
    askedAt = undefined;
    soundMs = undefined;
    report(ms).catch((error: unknown) => console.warn("Could not log the first sound", error));
  }

  return {
    asked() {
      askedAt = performance.now();
      soundMs = undefined;
      answered = false;
    },
    started() {
      if (askedAt === undefined || soundMs !== undefined) return;
      soundMs = performance.now() - askedAt;
      reportWhenReady();
    },
    cancel() {
      if (soundMs === undefined) askedAt = undefined;
    },
    answered() {
      answered = true;
      reportWhenReady();
    },
  };
}
