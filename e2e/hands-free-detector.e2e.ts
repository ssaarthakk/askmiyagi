import { expect, test } from "@playwright/test";
import { stubSpeaker } from "./speaker-stub.ts";

test.use({
  permissions: async ({ browserName }, use) => {
    await use(browserName === "chromium" ? ["microphone"] : []);
  },
  launchOptions: [
    async ({ browserName }, use) => {
      await use(
        browserName === "chromium"
          ? { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }
          : {
              firefoxUserPrefs: {
                "media.navigator.streams.fake": true,
                "media.navigator.permission.disabled": true,
              },
            },
      );
    },
    { scope: "worker" },
  ],
});

test("the voice detector loads its model and runtime from the Miyagi server", async ({
  page,
  baseURL,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.addInitScript(stubSpeaker);
  await page.goto("/");

  await page.getByRole("button", { name: "Hands-free" }).click();

  await expect(page.getByText("Listening hands-free")).toBeVisible({ timeout: 30_000 });
  const paths = requested.map((url) => new URL(url).pathname);
  expect(paths.some((path) => path.endsWith(".onnx"))).toBe(true);
  expect(paths.some((path) => path.endsWith(".wasm"))).toBe(true);
  expect(requested.filter((url) => !url.startsWith(`${baseURL}/`))).toEqual([]);
});
