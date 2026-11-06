import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(process.env.MIYAGI_LIVE !== "1", "downloads the Kokoro model; set MIYAGI_LIVE=1");
test.setTimeout(600_000);

const workerFile = readdirSync("dist/web/assets").find((file) => file.startsWith("kokoro-worker"));

const hearLocalVoice = `(async () => {
  const worker = new Worker("/assets/${workerFile}", { type: "module" });
  const wav = await new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") {
        worker.postMessage({ type: "run", id: 1, input: "Hello there. This reads the file." });
      }
      if (data.type === "failed" || data.type === "error") reject(new Error(data.message));
      if (data.type === "result") resolve(data.result);
    };
  });
  worker.terminate();
  const decoded = await new AudioContext().decodeAudioData(await wav.arrayBuffer());
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

test("the local voice decodes as speech, not static", async ({ page }) => {
  await page.goto("/");

  const heard = await page.evaluate<{ seconds: number; quietShare: number; opening: number }>(
    hearLocalVoice,
  );

  expect(heard.seconds).toBeGreaterThan(1);
  expect(heard.opening).toBeLessThan(0.01);
  expect(heard.quietShare).toBeGreaterThan(0.1);
});
