import type { Page } from "@playwright/test";

export const stubSpeaker = `
  window.spoken = [];
  window.aborted = [];
  window.announced = [];
  window.holdAnnouncements = false;
  window.holdStarts = false;
  window.submittedAt = 0;
  document.addEventListener("submit", () => {
    window.submittedAt = performance.now();
  }, true);
  window.__MIYAGI_SPEAKER__ = {
    speak(text, signal, onStart) {
      if (!onStart) {
        window.announced.push({ text, at: performance.now() });
        if (!window.holdAnnouncements) return Promise.resolve();
        return new Promise((resolve, reject) => {
          window.finishAnnouncement = resolve;
          window.failAnnouncement = reject;
          signal.addEventListener("abort", resolve);
        });
      }
      return new Promise((resolve) => {
        let finished = false;
        window.spoken.push(text);
        if (window.holdStarts) window.startSpeech = onStart;
        else onStart();
        window.finishSpeech = () => {
          finished = true;
          resolve();
        };
        signal.addEventListener("abort", () => {
          if (finished) return;
          window.aborted.push(text);
          resolve();
        });
      });
    },
  };
`;

export const spoken = (page: Page) => page.evaluate<string[]>("window.spoken");
export const finishSpeech = (page: Page) => page.evaluate("window.finishSpeech()");

export const heldAsk = `
  const realFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  window.fetch = (input, init) => {
    if (!String(input).endsWith("/api/ask")) return realFetch(input, init);
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            window.sendAskEvent = (event) =>
              controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\\n\\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
  };
`;

export function stepEvent(text: string) {
  return {
    type: "step",
    step: {
      title: "Step",
      anchors: [{ file: "src/clip-service.ts", symbol: "ClipService" }],
      narration: [{ text, anchor: 0 }],
    },
    ranges: [{ file: "src/clip-service.ts", start: 1, end: 2, capped: false }],
  };
}

export async function sendAskEvent(page: Page, event: object) {
  await page.waitForFunction("typeof window.sendAskEvent === 'function'");
  await page.evaluate(`window.sendAskEvent(${JSON.stringify(event)})`);
}

export const announced = (page: Page) =>
  page.evaluate<string[]>("window.announced.map((line) => line.text)");
