import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { finishTour, heldAsk, sendAskEvent, stepEvent } from "./speaker-stub.ts";

const suggestions = [
  "Where does this app start?",
  "What are the main parts of this project?",
  "Walk me through the most important flow",
];

const panelName = "Conversation panel";

test("before the first question the page shows the project name and three suggestions", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "basic" })).toBeVisible();
  for (const suggestion of suggestions) {
    await expect(page.getByRole("button", { name: suggestion })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Code" })).toHaveCount(0);
});

test("clicking a suggestion asks it, shows it as a question and replaces the welcome with code", async ({
  page,
}) => {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await page.goto("/");
  const request = page.waitForRequest("**/api/ask");

  await page.getByRole("button", { name: suggestions[1] ?? "" }).click();

  expect((await request).postDataJSON()).toEqual({ question: suggestions[1] });
  await expect(page.getByRole("region", { name: "Code" })).toBeVisible();
  await expect(page.getByRole("button", { name: suggestions[0] ?? "" })).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Conversation" }).getByText(suggestions[1] ?? ""),
  ).toBeVisible();
});

test("the code header shows the current file path", async ({ page }) => {
  await ask(page);

  await expect(
    page.getByRole("region", { name: "Code" }).getByRole("heading", { name: "package.json" }),
  ).toBeVisible();
});

test("Enter sends the question and Shift+Enter adds a line", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel("Question");
  await box.fill("First line");
  await box.press("Shift+Enter");
  await box.pressSequentially("Second line");
  await expect(box).toHaveValue("First line\nSecond line");
  const request = page.waitForRequest("**/api/ask");

  await box.press("Enter");

  expect((await request).postDataJSON()).toEqual({ question: "First line\nSecond line" });
  await expect(box).toHaveValue("");
});

test("the conversation shows the question, the tutor's lines, the tour and the check question in order", async ({
  page,
}) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  const check = "What does the save method return?";
  const one = stepEvent("Streamed one.");
  await sendAskEvent(page, { type: "progress", text: "Looking at clip-service.ts" });
  await sendAskEvent(page, one);
  await finishTour(page, check);
  await expect(page.getByText(check)).toBeVisible();

  const text = await page.getByRole("list", { name: "Conversation" }).innerText();
  const order = ["How are clips saved?", "Looking at clip-service.ts", "Step", check].map((part) =>
    text.indexOf(part),
  );
  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("a second question keeps the first one in the conversation", async ({ page }) => {
  await ask(page);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  const box = page.getByLabel("Question");
  await box.fill("And the second?");
  await box.press("Enter");

  const list = page.getByRole("list", { name: "Conversation" });
  await expect(list.getByText("How are clips saved?")).toBeVisible();
  await expect(list.getByText("And the second?")).toBeVisible();
});

test("the list scrolls to the newest message", async ({ page }) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  for (let line = 1; line <= 40; line++) {
    await sendAskEvent(page, { type: "progress", text: `Looking at file-${line}.ts` });
  }

  await expect(page.getByText("Looking at file-40.ts")).toBeInViewport();
});

test("the list scrolls to the newest step as steps stream into the tour", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.addInitScript(heldAsk);
  await ask(page);
  for (let step = 1; step <= 8; step++) {
    await sendAskEvent(page, stepEvent(`Streamed step ${step}.`));
  }

  await expect(page.getByText("Streamed step 8.")).toBeInViewport();
});

test("the Miyagi header and the composer controls are in the conversation panel", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: panelName });

  await expect(panel.getByRole("heading", { name: "Miyagi" })).toBeVisible();
  await expect(panel.getByLabel("Question")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send" })).toBeVisible();
});

test("the composer is pinned to the bottom of an empty conversation panel", async ({ page }) => {
  await page.goto("/");
  const panel = await page.getByRole("complementary", { name: panelName }).boundingBox();
  const send = await page.getByRole("button", { name: "Send" }).boundingBox();
  if (!panel || !send) throw new Error("the panel is not visible");

  expect(panel.y + panel.height - (send.y + send.height)).toBeLessThan(24);
});

test("below 900 px the conversation is above the code", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");

  const panel = await page.getByRole("complementary", { name: panelName }).boundingBox();
  const welcome = await page.getByRole("region", { name: "Welcome" }).boundingBox();
  if (!panel || !welcome) throw new Error("the panels are not visible");
  expect(panel.y).toBeLessThan(welcome.y);
  expect(panel.width).toBeGreaterThan(700);
});

test("at desktop width the conversation panel is about 400 px wide on the right", async ({
  page,
}) => {
  await page.goto("/");

  const panel = await page.getByRole("complementary", { name: panelName }).boundingBox();
  const welcome = await page.getByRole("region", { name: "Welcome" }).boundingBox();
  if (!panel || !welcome) throw new Error("the panels are not visible");
  expect(panel.width).toBeGreaterThan(350);
  expect(panel.width).toBeLessThan(450);
  expect(panel.x).toBeGreaterThan(welcome.x);
});

test("learner questions are right-aligned bubbles and tutor turns sit on the left", async ({
  page,
}) => {
  await page.addInitScript(heldAsk);
  await ask(page);
  const check = "What does the save method return?";
  const one = stepEvent("Streamed one.");
  await sendAskEvent(page, one);
  await finishTour(page, check);

  const list = page.getByRole("list", { name: "Conversation" });
  const listBox = await list.boundingBox();
  const questionBox = await list.getByText("How are clips saved?").boundingBox();
  const tutorBox = await list.getByText(check).boundingBox();
  if (!listBox || !questionBox || !tutorBox) throw new Error("the conversation is not visible");
  const listRight = listBox.x + listBox.width;
  expect(listRight - (questionBox.x + questionBox.width)).toBeLessThan(40);
  expect(questionBox.x - listBox.x).toBeGreaterThan(listBox.width * 0.15);
  expect(tutorBox.x - listBox.x).toBeLessThan(40);
  expect(listRight - (tutorBox.x + tutorBox.width)).toBeGreaterThan(listBox.width * 0.1);
});

test("the code viewer fills the window height", async ({ page }) => {
  await ask(page);

  const code = await page.getByRole("region", { name: "Code" }).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  if (!code) throw new Error("the code is not visible");
  expect(code.y).toBeLessThan(2);
  expect(code.y + code.height).toBeGreaterThan(height - 2);
  expect(code.y + code.height).toBeLessThan(height + 2);
});

test("every control shows a visible focus style when reached by keyboard", async ({ page }) => {
  await page.goto("/");

  for (let control = 0; control < suggestions.length + 2; control++) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveCSS("outline-style", "solid");
    await expect(focused).toHaveCSS("outline-width", "2px");
    await expect(focused).toHaveCSS("outline-color", "rgb(245, 184, 61)");
  }
});
