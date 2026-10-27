import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { spoken, stubSpeaker } from "./speaker-stub.ts";

test.describe("voice pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(stubSpeaker);
  });

  test("shows the step title and Pause, then Resume plays the interrupted segment again", async ({
    page,
  }) => {
    await ask(page);
    await expect.poll(() => spoken(page)).toEqual(["The project is called basic."]);
    const pill = page.getByRole("region", { name: "Voice controls" });

    await expect(pill.getByText("Project setup")).toBeVisible();
    await pill.getByRole("button", { name: "Pause" }).click();
    await expect(pill.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(pill.getByText("Project setup")).toBeVisible();

    await pill.getByRole("button", { name: "Resume" }).click();
    await expect(pill.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect
      .poll(() => spoken(page))
      .toEqual(["The project is called basic.", "The project is called basic."]);
  });

  test("Pause is the largest control in the pill", async ({ page }) => {
    await ask(page);
    const pill = page.getByRole("region", { name: "Voice controls" });
    const pause = await pill.getByRole("button", { name: "Pause" }).boundingBox();
    if (!pause) throw new Error("the Pause button is not visible");

    for (const name of ["Previous", "Next", "Voice"]) {
      const other = await pill.getByRole("button", { name }).boundingBox();
      if (!other) throw new Error(`the ${name} button is not visible`);
      expect(pause.width * pause.height).toBeGreaterThan(other.width * other.height);
    }
  });

  test("Next and Previous move the pill's step title", async ({ page }) => {
    await ask(page);
    await expect.poll(() => spoken(page)).toHaveLength(1);
    const pill = page.getByRole("region", { name: "Voice controls" });

    await pill.getByRole("button", { name: "Next" }).click();
    await pill.getByRole("button", { name: "Next" }).click();
    await expect(pill.getByText("Saving a clip")).toBeVisible();
    await pill.getByRole("button", { name: "Previous" }).click();
    await expect(pill.getByText("Project setup")).toBeVisible();
  });

  test("the level bars move while speaking and stand still when paused", async ({ page }) => {
    await ask(page);
    await expect.poll(() => spoken(page)).toHaveLength(1);
    const pill = page.getByRole("region", { name: "Voice controls" });
    const bar = pill.locator(".level-bars span").first();
    await expect(bar).toHaveCSS("animation-play-state", "running");
    await pill.getByRole("button", { name: "Pause" }).click();
    await expect(bar).toHaveCSS("animation-play-state", "paused");
  });

  test("with reduced motion the level bars do not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ask(page);
    await expect.poll(() => spoken(page)).toHaveLength(1);
    const bar = page
      .getByRole("region", { name: "Voice controls" })
      .locator(".level-bars span")
      .first();

    await expect(bar).toHaveCSS("animation-name", "none");
  });

  test("the Voice button turns the voice off and the tour's own controls take over", async ({
    page,
  }) => {
    await ask(page);
    const pill = page.getByRole("region", { name: "Voice controls" });

    await pill.getByRole("button", { name: "Voice" }).click();

    await expect(pill).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Tour" }).getByRole("button", { name: "Next" }),
    ).toBeVisible();
  });
});

test("in text mode there is no voice pill", async ({ page }) => {
  await ask(page);

  await expect(page.getByRole("region", { name: "Tour" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Voice controls" })).toHaveCount(0);
});

test("the voice pill sits at the bottom centre of the code pane", async ({ page }) => {
  await page.addInitScript(stubSpeaker);
  await ask(page);

  const pill = await page.getByRole("region", { name: "Voice controls" }).boundingBox();
  const pane = await page.locator(".code-pane").boundingBox();
  if (!pill || !pane) throw new Error("the voice pill is not visible");
  expect(Math.abs(pill.x + pill.width / 2 - (pane.x + pane.width / 2))).toBeLessThan(2);
  const gap = pane.y + pane.height - (pill.y + pill.height);
  expect(gap).toBeGreaterThan(0);
  expect(gap).toBeLessThan(48);
});
