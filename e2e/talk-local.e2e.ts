import { expect, test } from "@playwright/test";
import { holdMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { stubSpeaker } from "./speaker-stub.ts";

test("with the browser voice the recording goes to Whisper in the browser and is never uploaded", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  let uploads = 0;
  await page.route("**/api/transcribe", (route) => {
    uploads += 1;
    return route.abort();
  });
  let modelRequests = 0;
  await page.context().route("https://huggingface.co/**", (route) => {
    modelRequests += 1;
    return route.abort();
  });
  await page.goto("/");

  await holdMicrophone(page);

  await expect.poll(() => modelRequests).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Hold to talk" })).toBeEnabled();
  await page.waitForTimeout(300);
  expect(uploads).toBe(0);
});

test("the transcript is cleaned of fillers and repo symbol names before it is sent", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await page.addInitScript(
    "window.__MIYAGI_TRANSCRIBER__ = async () => 'Um, how does upload clip work?'",
  );
  await page.goto("/");
  const asked = page.waitForRequest("**/api/ask");

  await holdMicrophone(page);

  expect((await asked).postDataJSON()).toEqual({ question: "how does uploadClip work?" });
});

test("with the browser voice the transcriber's progress shows while transcribing", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await page.addInitScript(`
    window.__MIYAGI_TRANSCRIBER__ = (recording, notify) => {
      notify("Downloading the speech model: 40%");
      return new Promise(() => {});
    };
  `);
  await page.goto("/");

  await holdMicrophone(page);

  await expect(page.getByText("Downloading the speech model: 40%")).toBeVisible();
});

test("with the browser voice holding Space records, and Space on another button does not", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.addInitScript(stubMicrophone);
  await page.addInitScript("window.__MIYAGI_TRANSCRIBER__ = async () => 'Where does it start?'");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const asked = page.waitForRequest("**/api/ask");

  await page.getByRole("button", { name: "Send" }).focus();
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  expect(await page.evaluate("window.micRequests")).toBe(0);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Hold to talk" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.up("Space");

  expect((await asked).postDataJSON()).toEqual({ question: "Where does it start?" });
});
