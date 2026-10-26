import { expect, type Page } from "@playwright/test";

export async function ask(page: Page) {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await page.goto("/");
  if (!(await page.evaluate("'__MIYAGI_SPEAKER__' in window"))) {
    await expect(page.getByText("No local voice found; showing text")).toBeVisible();
  }
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");
}
