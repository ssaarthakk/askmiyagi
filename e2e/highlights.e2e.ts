import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";

const file = "src/clip-service.ts";
const longFile = Array.from(
  { length: 300 },
  (_, index) => `const line${index + 1} = ${index + 1};`,
);

function stepEvent(range: { start: number; end: number } | null, index: number) {
  const step = {
    title: `Step ${index + 1}`,
    anchors: [{ file, symbol: "ClipService" }],
    narration: [{ text: `Words ${index + 1}`, anchor: 0 }],
  };
  const ranges = [range && { file, ...range, capped: false }];
  return `data: ${JSON.stringify({ type: "step", step, ranges })}\n\n`;
}

async function askWithSteps(page: Page, steps: ({ start: number; end: number } | null)[]) {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `${steps.map(stepEvent).join("")}data: {"type":"done"}\n\n`,
    }),
  );
  await ask(page);
}

test("the anchor's lines are highlighted and others are not", async ({ page }) => {
  await askWithSteps(page, [{ start: 2, end: 3 }]);

  const lines = page.locator(".cm-line");
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(2)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(0)).not.toHaveClass(/cm-highlight/);
  await expect(lines.nth(3)).not.toHaveClass(/cm-highlight/);
});

test("the previous highlight is dimmed, not removed", async ({ page }) => {
  await askWithSteps(page, [
    { start: 1, end: 1 },
    { start: 2, end: 3 },
  ]);

  const lines = page.locator(".cm-line");
  await expect(lines.nth(0)).toHaveClass(/cm-highlight-current/);
  await page.getByRole("button", { name: "Words 2" }).click();

  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(0)).toHaveClass(/cm-highlight-previous/);
  await expect(lines.nth(0)).not.toHaveClass(/cm-highlight-current/);
});

test("a null range shows no highlight and no error", async ({ page }) => {
  await askWithSteps(page, [{ start: 2, end: 3 }, null]);

  await expect(page.locator(".cm-content")).toContainText("ClipService");
  await page.getByRole("button", { name: "Words 2" }).click();

  await expect(page.locator(".cm-highlight-current, .cm-highlight-previous")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a highlight far down a long file is scrolled into view", async ({ page }) => {
  await page.route("**/api/file*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ path: file, content: longFile.join("\n") }),
    }),
  );
  await askWithSteps(page, [{ start: 250, end: 252 }]);

  await expect(page.locator(".cm-highlight-current").first()).toBeInViewport();
  await expect(page.locator(".cm-highlight-current").first()).toContainText("line250");
});
