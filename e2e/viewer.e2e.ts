import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";

test("the viewer shows the current file's name and its code", async ({ page }) => {
  await ask(page);

  await expect(page.getByText("src/upload.ts", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("uploadClip");
});

test("the code has JS/TS syntax colours and cannot be edited", async ({ page }) => {
  await ask(page);

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

test("the file request carries the session token", async ({ page }) => {
  const token = async () => page.locator('meta[name="miyagi-token"]').getAttribute("content");
  const request = page.waitForRequest("**/api/file*");
  await ask(page);

  expect((await request).headers()["x-miyagi-token"]).toBe(await token());
});
