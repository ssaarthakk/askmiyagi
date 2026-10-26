import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";

test("the viewer shows the current file's name and its code", async ({ page }) => {
  await ask(page);

  await expect(page.getByText("package.json", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("dependencies");
});

test("the code has JS/TS syntax colours and cannot be edited", async ({ page }) => {
  await ask(page);
  await page.getByRole("button", { name: "Then the clip is uploaded." }).click();

  const content = page.locator(".cm-content");
  await expect(content).toContainText("uploadClip");
  await expect(content).toHaveAttribute("contenteditable", "false");
  const keyword = content.locator(".cm-line span").filter({ hasText: "export" }).first();
  await expect(content).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(keyword).not.toHaveCSS("color", "rgb(0, 0, 0)");
});

test("a refused path shows the server's error in place of the code", async ({ page }) => {
  await page.route("**/api/file*", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"error":"Path is not a visible file"}',
    }),
  );
  await ask(page);

  await expect(page.getByRole("alert")).toHaveText("Path is not a visible file");
  await expect(page.locator(".cm-content")).toBeHidden();
});

test("returning to a file after a failed load keeps its highlight", async ({ page }) => {
  await page.route("**/api/file*", (route) =>
    route.request().url().includes("clip-service")
      ? route.fulfill({
          status: 400,
          contentType: "application/json",
          body: '{"error":"Path is not a visible file"}',
        })
      : route.continue(),
  );
  await ask(page);
  await expect(page.locator(".cm-line").nth(1)).toHaveClass(/cm-highlight-current/);

  await page.getByRole("button", { name: "Clips are saved here." }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "It depends on zod." }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".cm-line").nth(7)).toHaveClass(/cm-highlight-current/);
});

test("the file request carries the session token", async ({ page }) => {
  const token = async () => page.locator('meta[name="miyagi-token"]').getAttribute("content");
  const request = page.waitForRequest("**/api/file*");
  await ask(page);

  expect((await request).headers()["x-miyagi-token"]).toBe(await token());
});
