import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { holdMicrophone, stubMicrophone } from "./microphone-stub.ts";
import { announced, stubSpeaker } from "./speaker-stub.ts";

const profileFile = join(
  process.env.MIYAGI_E2E_FOLDER ?? "",
  "basic",
  ".tutor",
  "private",
  "profile.json",
);

test.beforeEach(async ({ page }) => {
  await rm(profileFile, { force: true });
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
});

test.afterEach(() => rm(profileFile, { force: true }));

test("first launch asks the four questions one at a time and saves the profile", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });

  await expect(panel.getByText("How much experience do you have with code?")).toBeVisible();
  await expect(panel.getByText("Should I teach you as we go, or just answer?")).toBeHidden();
  await panel.getByRole("button", { name: "Beginner" }).click();
  await expect(panel.getByText("Should I teach you as we go, or just answer?")).toBeVisible();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Frequent" }).click();
  await expect(panel.getByText("What do you want to do with this repo?")).toBeVisible();
  const box = page.getByLabel("Question");
  await box.fill("Add a retry to uploads");
  await box.press("Enter");

  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  expect(JSON.parse(await readFile(profileFile, "utf8"))).toEqual({
    level: "beginner",
    mode: "teach",
    frequency: "frequent",
    goal: "Add a retry to uploads",
  });
});

test("a suggestion clicked while the goal question waits is asked, not saved as the goal", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  for (let skipped = 0; skipped < 3; skipped += 1) {
    await panel.getByRole("button", { name: "Skip" }).click();
  }
  await expect(panel.getByText("What do you want to do with this repo?")).toBeVisible();
  const request = page.waitForRequest("**/api/ask");

  await page.getByRole("button", { name: "Where does this app start?" }).click();

  expect((await request).postDataJSON()).toEqual({ question: "Where does this app start?" });
  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeHidden();
});

test("a saved profile is not asked for again, and the Profile button asks again with the answers chosen", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  expect(JSON.parse(await readFile(profileFile, "utf8"))).toEqual({
    level: "intermediate",
    mode: "teach",
    frequency: "normal",
    goal: null,
  });

  await page.reload();
  await expect(panel.getByRole("heading", { name: "Miyagi" })).toBeVisible();
  await expect(panel.getByText("How much experience do you have with code?")).toBeHidden();

  await panel.getByRole("button", { name: "Profile" }).click();
  await expect(panel.getByRole("button", { name: "Intermediate" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByRole("button", { name: "Beginner" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("each setup question is spoken, the first after the first click or key press", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  await expect(panel.getByText("How much experience do you have with code?")).toBeVisible();
  expect(await announced(page)).toEqual([]);

  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await expect.poll(() => announced(page)).toEqual(["How much experience do you have with code?"]);
  await panel.getByRole("button", { name: "Beginner" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Frequent" }).click();

  await expect
    .poll(() => announced(page))
    .toEqual([
      "How much experience do you have with code?",
      "Should I teach you as we go, or just answer?",
      "How often should I ask you questions to check you understood?",
      "What do you want to do with this repo?",
    ]);
});

test("the goal can be answered by push-to-talk", async ({ page }) => {
  await page.addInitScript(stubMicrophone);
  await page.addInitScript("window.__MIYAGI_TRANSCRIBER__ = async () => 'Add a retry to uploads'");
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  await panel.getByRole("button", { name: "Beginner" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Frequent" }).click();
  await expect(panel.getByText("What do you want to do with this repo?")).toBeVisible();

  await holdMicrophone(page);

  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  expect(JSON.parse(await readFile(profileFile, "utf8"))).toEqual({
    level: "beginner",
    mode: "teach",
    frequency: "frequent",
    goal: "Add a retry to uploads",
  });
});

test("skipping the goal when the Profile button asks again clears it", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();
  const box = page.getByLabel("Question");
  await box.fill("Add a retry to uploads");
  await box.press("Enter");
  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  expect(JSON.parse(await readFile(profileFile, "utf8")).goal).toBe("Add a retry to uploads");

  await panel.getByRole("button", { name: "Profile" }).click();
  await panel.getByRole("button", { name: "Beginner" }).click();
  await panel.getByRole("button", { name: "Teach" }).click();
  await panel.getByRole("button", { name: "Light" }).click();
  await panel.getByRole("button", { name: "Skip" }).click();

  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  expect(JSON.parse(await readFile(profileFile, "utf8"))).toEqual({
    level: "beginner",
    mode: "teach",
    frequency: "light",
    goal: null,
  });
});

test("a question asked after setup shows below the setup, and the setup questions stay above it", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  for (let skipped = 0; skipped < 4; skipped += 1) {
    await panel.getByRole("button", { name: "Skip" }).click();
  }
  await expect(panel.getByText("Saved. Press Profile any time to change it.")).toBeVisible();
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");

  const items = panel.getByRole("list", { name: "Conversation" }).getByRole("listitem");
  await expect(items.filter({ hasText: "How are clips saved?" })).toBeVisible();
  const texts = await items.allTextContents();
  const above = texts.slice(0, texts.indexOf("How are clips saved?"));
  expect(above).toContain("How much experience do you have with code?");
  expect(above).toContain("Saved. Press Profile any time to change it.");
});
