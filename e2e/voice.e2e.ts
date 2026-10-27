import { expect, test } from "@playwright/test";
import { useElevenLabsVoice } from "./speaker-stub.ts";

const noVoices = "speechSynthesis.getVoices = () => [];";

test("the browser voice with no local voice says the page stays in text mode", async ({ page }) => {
  await page.addInitScript(noVoices);
  await page.goto("/");

  await expect(page.getByText("No local voice found; showing text")).toBeVisible();
  await expect(page.getByText("Voice by ElevenLabs")).toBeHidden();
});

test("the elevenlabs voice is credited on the page", async ({ page }) => {
  await useElevenLabsVoice(page);
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  const credit = panel.getByText("Voice by ElevenLabs");

  await expect(credit).toBeVisible();
  const creditBox = await credit.boundingBox();
  const heading = await panel.getByRole("heading", { name: "Miyagi" }).boundingBox();
  if (!creditBox || !heading) throw new Error("the panel header is not visible");
  expect(creditBox.y).toBeLessThan(heading.y + heading.height);
  expect(creditBox.y + creditBox.height).toBeGreaterThan(heading.y);
});
