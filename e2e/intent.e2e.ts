import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";

async function answerWithIntent(page: Page, intent: string) {
  const tour = { question: "q", steps: [], reply: "Fine.", intent };
  const body = `data: ${JSON.stringify({ type: "tour", tour, ranges: [] })}\n\ndata: {"type":"done"}\n\n`;
  await page.route("**/api/ask", (route) =>
    route.fulfill({ contentType: "text/event-stream", body }),
  );
}

async function askAgain(page: Page, question: string) {
  const asked = page.waitForRequest((request) => request.url().endsWith("/api/ask"));
  const box = page.getByLabel("Question");
  await box.fill(question);
  await box.press("Enter");
  return (await asked).postDataJSON();
}

test("the question bubble shows the inferred intent, and a chosen intent rides on every later ask until Auto", async ({
  page,
}) => {
  await answerWithIntent(page, "debugging");
  await ask(page);
  const chip = page.getByLabel("Intent", { exact: true });

  await expect(chip).toHaveValue("auto");
  await expect(chip.locator("option:checked")).toHaveText("Auto: Debugging");

  await chip.selectOption("interview");
  expect((await askAgain(page, "And the upload?")).intent).toBe("interview");
  expect((await askAgain(page, "And the cap?")).intent).toBe("interview");

  await page.getByLabel("Intent", { exact: true }).selectOption("auto");
  expect((await askAgain(page, "And the limit?")).intent).toBeUndefined();
});

test("the first ask carries no intent", async ({ page }) => {
  await answerWithIntent(page, "onboarding");
  const asked = page.waitForRequest((request) => request.url().endsWith("/api/ask"));

  await ask(page);

  expect((await asked).postDataJSON().intent).toBeUndefined();
  await expect(page.getByLabel("Intent", { exact: true }).locator("option:checked")).toHaveText(
    "Auto: Onboarding",
  );
});

test("after an ask that ends without a tour, the last intent can still be set back to Auto", async ({
  page,
}) => {
  await answerWithIntent(page, "debugging");
  await ask(page);
  await page.getByLabel("Intent", { exact: true }).selectOption("interview");
  await page.unroute("**/api/ask");
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"error","message":"Nothing to explain."}\n\n',
    }),
  );
  await askAgain(page, "And the upload?");
  await expect(page.getByText("Nothing to explain.")).toBeVisible();

  await page.getByLabel("Intent", { exact: true }).selectOption("auto");

  expect((await askAgain(page, "And the limit?")).intent).toBeUndefined();
});
