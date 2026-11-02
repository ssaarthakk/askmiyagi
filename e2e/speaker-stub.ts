import type { Page } from "@playwright/test";

export const stubSpeaker = `
  window.spoken = [];
  window.spokenAt = [];
  window.fileShownAt = {};
  new MutationObserver(() => {
    const name = document.querySelector("section[aria-label='Code'] h2")?.textContent;
    if (name && !(name in window.fileShownAt)) window.fileShownAt[name] = performance.now();
  }).observe(document, { childList: true, subtree: true, characterData: true });
  window.aborted = [];
  window.announced = [];
  window.holdAnnouncements = false;
  window.holdStarts = false;
  window.submittedAt = 0;
  document.addEventListener("submit", () => {
    window.submittedAt = performance.now();
  }, true);
  window.rates = [];
  window.volumes = [];
  window.__MIYAGI_SPEAKER__ = {
    setRate(rate) {
      window.rates.push(rate);
    },
    setVolume(volume) {
      window.volumes.push(volume);
    },
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
        window.spokenAt.push(performance.now());
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
  window.askedQuestions = [];
  window.fetch = (input, init) => {
    if (!String(input).endsWith("/api/ask")) return realFetch(input, init);
    window.askedQuestions.push(JSON.parse(init.body).question);
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            window.endAsk = () => controller.close();
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

export const endAsk = (page: Page) => page.evaluate("window.endAsk()");

export const announced = (page: Page) =>
  page.evaluate<string[]>("window.announced.map((line) => line.text)");

export async function finishTour(page: Page, checkQuestion: string) {
  const one = stepEvent("Streamed one.");
  await sendAskEvent(page, {
    type: "tour",
    tour: { question: "How are clips saved?", steps: [one.step], checkQuestion },
    ranges: [one.ranges],
  });
  await sendAskEvent(page, { type: "done" });
}

export async function useElevenLabsVoice(page: Page) {
  await page.route("/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'name="miyagi-voice" content="browser"',
      'name="miyagi-voice" content="elevenlabs"',
    );
    await route.fulfill({ response, body });
  });
}
