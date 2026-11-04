import { expect, type Page } from "@playwright/test";

export function stubProfile(page: Page, mode = "teach") {
  return page.route("**/api/profile", (route) =>
    route.fulfill({
      json: { level: "intermediate", mode, frequency: "normal", goal: null },
    }),
  );
}

export async function ask(page: Page, mode = "teach") {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await stubProfile(page, mode);
  await page.goto("/");
  if (!(await page.evaluate("'__MIYAGI_SPEAKER__' in window"))) {
    await expect(page.getByText("No local voice found; showing text")).toBeVisible();
  }
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");
}

export function countAsks(page: Page) {
  const questions: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/ask")) questions.push(request.postDataJSON().question);
  });
  return questions;
}

export function bodiesPostedTo(page: Page, path: string) {
  const bodies: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(path)) bodies.push(request.postDataJSON());
  });
  return bodies;
}
