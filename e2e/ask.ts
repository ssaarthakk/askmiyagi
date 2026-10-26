import type { Page } from "@playwright/test";

export async function ask(page: Page) {
  await page.goto("/");
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");
}
