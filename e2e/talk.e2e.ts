import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { holdMicrophone, pressMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { stubSpeaker, useElevenLabsVoice } from "./speaker-stub.ts";

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

test("holding the microphone button records and sends the transcript as a question", async ({
  page,
}) => {
  const uploads = await openWithElevenLabs(page, "How are clips saved?");
  const asked = page.waitForRequest("**/api/ask");

  await holdMicrophone(page);

  expect((await asked).postDataJSON()).toEqual({ question: "How are clips saved?" });
  expect(uploads).toEqual([{ type: "audio/webm", token: expect.any(String), size: 3 }]);
  expect(uploads[0]?.token).not.toBe("");
  await expect(page.getByLabel("Question")).toHaveValue("");
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
    current: { tour: "How are clips saved?", step: 2, segmentIndex: 0 },
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

test("after pausing with the mouse, holding Space asks instead of resuming", async ({ page }) => {
  await openWithElevenLabs(page, "What does runCli do?");
  await ask(page);
  await expect.poll(() => page.evaluate<number>("window.spoken.length")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause" }).click();
  const spokenBefore = await page.evaluate<number>("window.spoken.length");
  const asked = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/ask") && request.postData()?.includes("runCli") === true,
  );

  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Hold to talk" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("Space");

  expect((await asked).postDataJSON()).toEqual({
    question: "What does runCli do?",
    current: { tour: "How are clips saved?", step: 0, segmentIndex: 0 },
  });
  expect(await page.evaluate<number>("window.spoken.length")).toBe(spokenBefore);
});

test("an interrupting question is answered, then the earlier tour continues where it stopped", async ({
  page,
}) => {
  await openWithElevenLabs(page, "What does runCli do?");
  await ask(page);
  await expect.poll(() => page.evaluate<number>("window.spoken.length")).toBeGreaterThan(0);
  const interrupted = await page.evaluate<string>("window.spoken.at(-1)");

  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect(page.getByText("What does runCli do?")).toBeVisible();

  const backAgain = "window.announced.some((line) => line.text === 'Now, back to where we were.')";
  for (let turn = 0; turn < 30 && !(await page.evaluate<boolean>(backAgain)); turn++) {
    await page.evaluate("window.finishSpeech?.()");
    await page.waitForTimeout(100);
  }

  expect(await page.evaluate<boolean>(backAgain)).toBe(true);
  await expect.poll(() => page.evaluate<string>("window.spoken.at(-1)")).toBe(interrupted);
  await expect(page.getByText("Back to where we were")).toBeVisible();
});
