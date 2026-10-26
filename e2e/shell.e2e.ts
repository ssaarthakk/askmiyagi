import { expect, test } from "@playwright/test";
import { ackPhrases } from "../src/shared/phrases.ts";
import { ask } from "./ask.ts";

test("asking shows the ack and progress messages and frees the box when done", async ({ page }) => {
  await ask(page);

  await expect(page.getByText(new RegExp(ackPhrases.join("|")))).toBeVisible();
  await expect(page.getByText("Looking at clip-service.ts")).toBeVisible();
  await expect(page.getByLabel("Question")).toBeEnabled();
});

test("the box is disabled while an ask runs", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ask", async (route) => {
    await gate;
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"ack","text":"Hold on."}\n\ndata: {"type":"done"}\n\n',
    });
  });
  await ask(page);
  const box = page.getByLabel("Question");

  await expect(box).toBeDisabled();
  release();
  await expect(page.getByText("Hold on.")).toBeVisible();
  await expect(box).toBeEnabled();
});

test("the ask request carries the session token from the page", async ({ page }) => {
  const request = page.waitForRequest("**/api/ask");
  await ask(page);
  const token = await page.locator('meta[name="miyagi-token"]').getAttribute("content");

  expect((await request).headers()["x-miyagi-token"]).toBe(token);
});

test("an error event is shown", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"error","message":"Claude Code is not logged in"}\n\ndata: {"type":"done"}\n\n',
    }),
  );
  await ask(page);

  await expect(page.getByText("Claude Code is not logged in")).toBeVisible();
});

test("a refused ask shows the server's error", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: '{"error":"An ask is already running"}',
    }),
  );
  await ask(page);

  await expect(page.getByText("An ask is already running")).toBeVisible();
});
