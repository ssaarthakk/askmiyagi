import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { stubSpeaker, useElevenLabsVoice } from "./speaker-stub.ts";

const stubMicrophone = `
  window.micRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    window.micRequests += 1;
    if (window.micDenied) throw new DOMException("denied", "NotAllowedError");
    if (window.holdMic) await new Promise((resolve) => { window.openMic = resolve; });
    return { getTracks: () => [{ stop() {} }] };
  };
  window.MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    mimeType = "audio/webm";
    listeners = {};
    addEventListener(name, listener) {
      (this.listeners[name] ??= []).push(listener);
    }
    start() {}
    stop() {
      for (const listener of this.listeners.dataavailable ?? []) {
        listener({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }) });
      }
      for (const listener of this.listeners.stop ?? []) listener({});
    }
  };
`;

async function openWithElevenLabs(page: Page, transcript: string) {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await useElevenLabsVoice(page);
  const uploads: { type: string | undefined; token: string | undefined; size: number }[] = [];
  await page.route("**/api/transcribe", async (route) => {
    const request = route.request();
    uploads.push({
      type: request.headers()["content-type"],
      token: request.headers()["x-miyagi-token"],
      size: request.postDataBuffer()?.length ?? 0,
    });
    await route.fulfill({ json: { text: transcript } });
  });
  await page.goto("/");
  return uploads;
}

async function pressMicrophone(page: Page) {
  const box = await page.getByRole("button", { name: "Hold to talk" }).boundingBox();
  if (!box) throw new Error("the microphone button is not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

async function holdMicrophone(page: Page) {
  await pressMicrophone(page);
  await expect(page.getByRole("button", { name: "Hold to talk" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.mouse.up();
}

test("holding the microphone button records and sends the transcript as a question", async ({
  page,
}) => {
  const uploads = await openWithElevenLabs(page, "How are clips saved?");
  const asked = page.waitForRequest("**/api/ask");

  await holdMicrophone(page);

  expect((await asked).postDataJSON()).toEqual({ question: "How are clips saved?" });
  expect(uploads).toEqual([{ type: "audio/webm", token: expect.any(String), size: 3 }]);
  expect(uploads[0]?.token).not.toBe("");
  await expect(page.getByLabel("Question")).toHaveValue("How are clips saved?");
});

test("a picked symbol is sent with the spoken question", async ({ page }) => {
  await openWithElevenLabs(page, "What does this do?");
  await ask(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page.getByRole("button", { name: "Then the clip is uploaded." }).click();
  await expect(page.locator(".cm-content")).toContainText("uploadClip");
  await page.locator(".cm-content").getByText("uploadClip").click();
  await expect(page.getByText("src/upload.ts:1", { exact: true })).toBeVisible();
  const asked = page.waitForRequest("**/api/ask");

  await holdMicrophone(page);

  expect((await asked).postDataJSON()).toEqual({
    question: "What does this do?",
    selection: { file: "src/upload.ts", start: 1, end: 1, text: "uploadClip" },
  });
});

test("holding Space outside a text field records, and Space inside the question box types a space", async ({
  page,
}) => {
  await openWithElevenLabs(page, "Where does it start?");
  const asked = page.waitForRequest("**/api/ask");

  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Hold to talk" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("Space");

  expect((await asked).postDataJSON()).toEqual({ question: "Where does it start?" });

  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  const box = page.getByLabel("Question");
  await box.fill("");
  await box.press("Space");
  expect(await page.evaluate("window.micRequests")).toBe(1);
  await expect(box).toHaveValue(" ");
});

test("recording pauses the narration", async ({ page }) => {
  await openWithElevenLabs(page, "Anything");
  await ask(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await expect.poll(() => page.evaluate<number>("window.spoken.length")).toBeGreaterThan(0);
  expect(await page.evaluate<number>("window.aborted.length")).toBe(0);

  await pressMicrophone(page);

  await expect.poll(() => page.evaluate<number>("window.aborted.length")).toBeGreaterThan(0);
  await page.mouse.up();
});

test("an empty transcript says it did not catch that and sends nothing", async ({ page }) => {
  await openWithElevenLabs(page, "");
  let asks = 0;
  await page.route("**/api/ask", (route) => {
    asks += 1;
    return route.abort();
  });

  await holdMicrophone(page);

  await expect(page.getByText("Didn't catch that")).toBeVisible();
  expect(asks).toBe(0);
});

test("a failed transcription shows the error", async ({ page }) => {
  await openWithElevenLabs(page, "unused");
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({ status: 502, json: { error: "Speech-to-text failed: 401" } }),
  );

  await holdMicrophone(page);

  await expect(page.getByText("Speech-to-text failed: 401")).toBeVisible();
});

test("a denied microphone shows a message and typing still works", async ({ page }) => {
  await openWithElevenLabs(page, "unused");
  await page.evaluate("window.micDenied = true");

  await pressMicrophone(page);
  await page.mouse.up();

  await expect(page.getByText("Microphone unavailable", { exact: false })).toBeVisible();
  const asked = page.waitForRequest("**/api/ask");
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");
  expect((await asked).postDataJSON()).toMatchObject({ question: "How are clips saved?" });
});

test("releasing before the microphone opens sends nothing and says to hold", async ({ page }) => {
  const uploads = await openWithElevenLabs(page, "unused");
  await page.evaluate("window.holdMic = true");

  await pressMicrophone(page);
  await page.mouse.up();
  await page.waitForFunction("typeof window.openMic === 'function'");
  await page.evaluate("window.openMic()");

  await expect(page.getByText("Hold the button while you speak")).toBeVisible();
  expect(uploads).toEqual([]);
});

test("holding again while the last recording is transcribing does not open the microphone", async ({
  page,
}) => {
  await openWithElevenLabs(page, "unused");
  let answer = () => {};
  await page.route("**/api/transcribe", async (route) => {
    await new Promise<void>((resolve) => {
      answer = resolve;
    });
    await route.fulfill({ json: { text: "First question" } });
  });

  await holdMicrophone(page);
  await expect(page.getByText("Transcribing...")).toBeVisible();
  await pressMicrophone(page);
  await page.mouse.up();

  expect(await page.evaluate("window.micRequests")).toBe(1);
  answer();
});

test("leaving the window while holding Space stops recording and sends it", async ({ page }) => {
  await openWithElevenLabs(page, "Where does it start?");
  const asked = page.waitForRequest("**/api/ask");
  await page.keyboard.down("Space");
  const microphone = page.getByRole("button", { name: "Hold to talk" });
  await expect(microphone).toHaveAttribute("aria-pressed", "true");

  await page.evaluate("window.dispatchEvent(new Event('blur'))");

  await expect(microphone).toHaveAttribute("aria-pressed", "false");
  expect((await asked).postDataJSON()).toEqual({ question: "Where does it start?" });
  await page.keyboard.up("Space");
});

test("with the browser voice there is no microphone button", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Hold to talk" })).toBeHidden();
});

test("with the browser voice holding Space never opens the microphone", async ({ page }) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  let transcribes = 0;
  await page.route("**/api/transcribe", (route) => {
    transcribes += 1;
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.keyboard.down("Space");
  await page.keyboard.up("Space");

  expect(await page.evaluate("window.micRequests")).toBe(0);
  expect(transcribes).toBe(0);
});
