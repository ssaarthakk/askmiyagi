import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";

async function showUpload(page: Page) {
  await ask(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  await page.getByRole("button", { name: "Then the clip is uploaded." }).click();
  await expect(page.locator(".cm-content")).toContainText("uploadClip");
}

async function askAgain(page: Page) {
  const request = page.waitForRequest("**/api/ask");
  const box = page.getByLabel("Question");
  await box.fill("What does this do?");
  await box.press("Enter");
  return (await request).postDataJSON();
}

test("clicking a symbol attaches its line and name, shown as a chip, sent with the next question and then cleared", async ({
  page,
}) => {
  await showUpload(page);
  await page.locator(".cm-content").getByText("uploadClip").click();

  await expect(page.getByText("src/upload.ts:1", { exact: true })).toBeVisible();
  const body = await askAgain(page);
  expect(body.selection).toEqual({ file: "src/upload.ts", start: 1, end: 1, text: "uploadClip" });
  await expect(page.getByText("src/upload.ts:1", { exact: true })).toBeHidden();

  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  expect((await askAgain(page)).selection).toBeUndefined();
});

test("selecting several lines attaches them with the selected text", async ({ page }) => {
  await showUpload(page);
  const lines = page.locator(".cm-line");
  const first = await lines.nth(0).boundingBox();
  const last = await lines.nth(2).boundingBox();
  if (!first || !last) throw new Error("code lines are not visible");
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByText("src/upload.ts:1-3", { exact: true })).toBeVisible();
  const body = await askAgain(page);
  expect(body.selection).toMatchObject({ file: "src/upload.ts", start: 1, end: 3 });
  expect(body.selection.text).toContain("return path;");
});

test("the chip sits above the question box", async ({ page }) => {
  await showUpload(page);
  await page.locator(".cm-content").getByText("uploadClip").click();

  const chip = await page.getByText("src/upload.ts:1", { exact: true }).boundingBox();
  const box = await page.getByLabel("Question").boundingBox();
  if (!chip || !box) throw new Error("the chip or question box is not visible");
  expect(chip.y + chip.height).toBeLessThanOrEqual(box.y);
});

test("the chip can be removed so the next question carries no selection", async ({ page }) => {
  await showUpload(page);
  await page.locator(".cm-content").getByText("uploadClip").click();
  await expect(page.getByText("src/upload.ts:1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove selection" }).click();

  await expect(page.getByText("src/upload.ts:1", { exact: true })).toBeHidden();
  expect((await askAgain(page)).selection).toBeUndefined();
});
