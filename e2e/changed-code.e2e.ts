import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";

const file = "src/clip-service.ts";

async function askThenSend(page: Page, ...events: object[]) {
  const step = {
    title: "Step 1",
    anchors: [{ file, symbol: "ClipService" }],
    narration: [{ text: "Words 1", anchor: 0 }],
  };
  const shown = { type: "step", step, ranges: [{ file, start: 2, end: 3, capped: false }] };
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(shown)}\n\ndata: {"type":"done"}\n\n`,
    }),
  );
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/events", async (route) => {
    await released;
    await route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  await ask(page);
  const lines = page.locator(".cm-line");
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  release();
  return lines;
}

test("an edited file moves the highlight to the re-resolved lines", async ({ page }) => {
  const lines = await askThenSend(page, {
    type: "ranges",
    ranges: [[{ file, start: 4, end: 4, capped: false }]],
  });

  await expect(lines.nth(3)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(1)).not.toHaveClass(/cm-highlight/);
});

test("code that can no longer be found loses its highlight and says so", async ({ page }) => {
  const lines = await askThenSend(
    page,
    { type: "ranges", ranges: [[null]] },
    { type: "stale", file },
  );

  await expect(page.getByText("Code changed; highlight removed")).toBeVisible();
  await expect(lines.nth(1)).not.toHaveClass(/cm-highlight/);
});
