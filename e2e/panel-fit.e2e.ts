import { expect, type Page, test } from "@playwright/test";

const screens = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 800, height: 900 },
];

const panel = (page: Page) => page.getByRole("complementary", { name: "Conversation panel" });

async function expectEverythingFits(page: Page) {
  const overflow = await page.evaluate<number>(
    "document.documentElement.scrollWidth - window.innerWidth",
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  const tallness = await page.evaluate<number>(
    "document.documentElement.scrollHeight - window.innerHeight",
  );
  expect(tallness, "the page scrolls down").toBeLessThanOrEqual(0);
  const box = await panel(page).boundingBox();
  if (!box) throw new Error("the conversation panel is not visible");
  for (const button of await panel(page).getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    const inside = await button.boundingBox();
    if (!inside) continue;
    const name = await button.textContent();
    expect(inside.x, `"${name}" starts left of the panel`).toBeGreaterThanOrEqual(box.x);
    expect(inside.x + inside.width, `"${name}" runs past the panel`).toBeLessThanOrEqual(
      box.x + box.width + 1,
    );
  }
}

for (const screen of screens) {
  test(`the panel fits at ${screen.width}x${screen.height}`, async ({ page }) => {
    await page.setViewportSize(screen);
    await page.addInitScript("speechSynthesis.getVoices = () => [];");
    await page.goto("/");
    await expect(panel(page).getByRole("button", { name: "Mock interview" })).toBeVisible();

    await expectEverythingFits(page);

    await panel(page).getByRole("button", { name: "Mock interview" }).click();
    await expect(panel(page).getByRole("button", { name: "Start" })).toBeVisible();

    await expectEverythingFits(page);
  });
}

const actions = ["Teach mode", "Profile", "Plan a learning path", "Mock interview"];

for (const screen of screens) {
  test(`the panel actions form an even two-by-two grid at ${screen.width}x${screen.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(screen);
    await page.addInitScript("speechSynthesis.getVoices = () => [];");
    await page.goto("/");

    const boxes = [];
    for (const name of actions) {
      const box = await panel(page)
        .getByRole(name === "Teach mode" ? "switch" : "button", { name })
        .boundingBox();
      if (!box) throw new Error(`${name} is not visible`);
      boxes.push(box);
    }
    const [teach, profile, plan, interview] = boxes;
    if (!teach || !profile || !plan || !interview) throw new Error("an action is missing");
    for (const box of boxes) {
      expect(Math.abs(box.width - teach.width), "the actions have the same width").toBeLessThan(2);
      expect(Math.abs(box.height - teach.height), "the actions have the same height").toBeLessThan(
        2,
      );
    }
    expect(Math.abs(profile.y - teach.y), "Profile sits beside Teach mode").toBeLessThan(2);
    expect(Math.abs(interview.y - plan.y), "Mock interview sits beside the path").toBeLessThan(2);
    expect(plan.y, "the second row is below the first").toBeGreaterThan(teach.y + teach.height);
    expect(Math.abs(plan.x - teach.x), "the columns line up").toBeLessThan(2);
  });
}
