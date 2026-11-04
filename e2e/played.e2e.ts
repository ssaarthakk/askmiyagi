import { expect, type Page, test } from "@playwright/test";
import { ask } from "./ask.ts";
import { finishSpeech, spoken, stubSpeaker } from "./speaker-stub.ts";

function playedTours(page: Page) {
  const tours: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/played")) tours.push(request.postDataJSON().tour);
  });
  return tours;
}

test("with voice off, the tour is reported played as soon as it is shown", async ({ page }) => {
  const tours = playedTours(page);

  await ask(page);

  await expect.poll(() => tours).toEqual(["How are clips saved?"]);
});

test("with voice on, the tour is reported played only after its last segment has been spoken", async ({
  page,
}) => {
  await page.addInitScript(stubSpeaker);
  const tours = playedTours(page);
  await ask(page);

  for (let spokenCount = 1; spokenCount <= 3; spokenCount += 1) {
    await expect.poll(() => spoken(page)).toHaveLength(spokenCount);
    await finishSpeech(page);
  }
  await expect.poll(() => spoken(page)).toHaveLength(4);
  expect(tours).toEqual([]);

  await finishSpeech(page);

  await expect.poll(() => tours).toEqual(["How are clips saved?"]);
});

test("turning the voice off mid-tour reports the tour played", async ({ page }) => {
  await page.addInitScript(stubSpeaker);
  const tours = playedTours(page);
  await ask(page);
  await expect.poll(() => spoken(page)).toHaveLength(1);

  await page.getByRole("button", { name: "Voice", exact: true }).click();

  await expect.poll(() => tours).toEqual(["How are clips saved?"]);
});

test("an ask that fails reports nothing played", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/ask" || path === "/api/played") calls.push(path);
  });
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"error","message":"The tutor failed"}\n\n',
    }),
  );
  await ask(page);
  await expect(page.getByText("The tutor failed")).toBeVisible();

  const box = page.getByLabel("Question");
  await box.fill("How are clips uploaded?");
  await box.press("Enter");

  await expect.poll(() => calls).toEqual(["/api/ask", "/api/ask"]);
});
