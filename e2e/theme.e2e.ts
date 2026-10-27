import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { heldAsk, sendAskEvent } from "./speaker-stub.ts";

const panelName = "Conversation panel";

test("the dark theme tokens are applied", async ({ page }) => {
  await ask(page);

  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(15, 17, 21)");
  await expect(page.getByRole("complementary", { name: panelName })).toHaveCSS(
    "background-color",
    "rgb(22, 26, 33)",
  );
  await expect(page.locator(".cm-highlight-current").first()).toHaveCSS(
    "background-color",
    "rgba(245, 184, 61, 0.22)",
  );
  await expect(page.getByRole("button", { name: "Send" })).toHaveCSS(
    "background-color",
    "rgb(245, 184, 61)",
  );
  await expect(page.getByRole("button", { name: "Send" })).toHaveCSS("border-radius", "10px");
  await expect(page.getByRole("complementary", { name: panelName })).toHaveCSS(
    "border-left-color",
    "rgb(38, 44, 54)",
  );
  await expect(page.getByRole("complementary", { name: panelName }).locator("form")).toHaveCSS(
    "padding",
    "16px",
  );
  await expect(page.locator("body")).toHaveCSS("font-family", /^system-ui, /);
  await expect(page.locator(".cm-scroller")).toHaveCSS("font-family", /^ui-monospace, /);
});

test("progress notes are muted and errors use the error colour", async ({ page }) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  await sendAskEvent(page, { type: "progress", text: "Looking at clip-service.ts" });
  await sendAskEvent(page, { type: "error", message: "The model is unavailable" });
  const list = page.getByRole("list", { name: "Conversation" });

  await expect(list.getByText("Looking at clip-service.ts")).toHaveCSS(
    "color",
    "rgb(139, 147, 161)",
  );
  await expect(list.getByText("The model is unavailable")).toHaveCSS("color", "rgb(255, 107, 107)");
});

test("the editor follows the theme tokens", async ({ page }) => {
  await page.addInitScript(
    "document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('--accent', 'rgb(1, 2, 3)'))",
  );
  await ask(page);
  await page.locator(".cm-content").selectText();

  await expect(page.locator(".cm-selectionBackground").first()).toHaveCSS(
    "background-color",
    /^color\(srgb 0\.0039\d* 0\.0078\d* 0\.0117\d* \/ 0\.35\)$/,
  );
});
