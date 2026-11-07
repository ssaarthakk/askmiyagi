import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.skip(process.env.MIYAGI_LIVE !== "1", "downloads the voice models; set MIYAGI_LIVE=1");
test.setTimeout(1_800_000);

type Heard =
  | { failed: string }
  | { failed?: undefined; seconds: number; quietShare: number; opening: number };

const assets = readdirSync("dist/web/assets");

function hearLocalVoice(workerPrefix: string) {
  const workerFile = assets.find((file) => file.startsWith(workerPrefix));
  return `(async () => {
    const worker = new Worker("/assets/${workerFile}", { type: "module" });
    const reply = await new Promise((resolve) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          worker.postMessage({ type: "run", id: 1, input: "Hello there. This reads the file." });
        }
        if (data.type === "failed" || data.type === "error") resolve({ failed: data.message });
        if (data.type === "result") resolve({ wav: data.result });
      };
    });
    worker.terminate();
    if (reply.failed) return reply;
    const decoded = await new AudioContext().decodeAudioData(await reply.wav.arrayBuffer());
    const samples = decoded.getChannelData(0);
    const frame = Math.round(decoded.sampleRate / 50);
    const loudness = [];
    for (let start = 0; start + frame <= samples.length; start += frame) {
      let sum = 0;
      for (let index = start; index < start + frame; index++) sum += samples[index] ** 2;
      loudness.push(Math.sqrt(sum / frame));
    }
    return {
      seconds: decoded.duration,
      quietShare: loudness.filter((level) => level < 0.01).length / loudness.length,
      opening: loudness[0],
    };
  })()`;
}

function expectSpeech(heard: Heard) {
  if (heard.failed !== undefined) throw new Error(`the voice failed: ${heard.failed}`);
  expect(heard.seconds).toBeGreaterThan(1);
  expect(heard.opening).toBeLessThan(0.01);
  expect(heard.quietShare).toBeGreaterThan(0.1);
}

test("the Kokoro voice decodes as speech, not static", async ({ page }) => {
  await page.goto("/");

  expectSpeech(await page.evaluate<Heard>(hearLocalVoice("kokoro-worker")));
});

test("the Chatterbox voice decodes as speech, or says it needs WebGPU", async ({ page }) => {
  await page.goto("/");
  const webgpu = await page.evaluate<boolean>(
    "(async () => Boolean(await navigator.gpu?.requestAdapter().catch(() => null)))()",
  );

  const heard = await page.evaluate<Heard>(hearLocalVoice("chatterbox-worker"));

  if (webgpu) expectSpeech(heard);
  else expect(heard).toEqual({ failed: "Chatterbox needs WebGPU" });
});

test("in Chrome with WebGPU, a second Chatterbox load downloads no model weights again", async ({
  browserName,
  playwright,
  baseURL,
}) => {
  test.skip(browserName !== "chromium", "Chatterbox runs on Chrome's WebGPU");
  const profile = mkdtempSync(join(tmpdir(), "miyagi-chrome-"));
  const chrome = await playwright.chromium.launchPersistentContext(profile, {
    channel: "chrome",
    args: ["--enable-unsafe-webgpu"],
    baseURL,
  });
  try {
    const weights: string[] = [];
    chrome.on("response", (response) => {
      if (response.url().includes(".onnx_data") && response.status() < 400) {
        weights.push(response.url());
      }
    });
    const page = await chrome.newPage();
    await page.goto("/");
    expectSpeech(await page.evaluate<Heard>(hearLocalVoice("chatterbox-worker")));
    expect(weights.length).toBeGreaterThan(0);
    weights.length = 0;

    expectSpeech(await page.evaluate<Heard>(hearLocalVoice("chatterbox-worker")));

    expect(weights).toEqual([]);
  } finally {
    await chrome.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
