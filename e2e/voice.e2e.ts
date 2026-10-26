import { expect, test } from "@playwright/test";

const noVoices = "speechSynthesis.getVoices = () => [];";

test("the browser voice with no local voice says the page stays in text mode", async ({ page }) => {
  await page.addInitScript(noVoices);
  await page.goto("/");

  await expect(page.getByText("No local voice found; showing text")).toBeVisible();
  await expect(page.getByText("Voice by ElevenLabs")).toBeHidden();
});

test("the elevenlabs voice is credited on the page", async ({ page }) => {
  await page.route("/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'name="miyagi-voice" content="browser"',
      'name="miyagi-voice" content="elevenlabs"',
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/");

  await expect(page.getByText("Voice by ElevenLabs")).toBeVisible();
});
