import { expect, type Page, test } from "@playwright/test";
import { bodiesPostedTo, countAsks } from "./ask.ts";

const items = [
  { concept: "Storage", question: "How is data stored?", file: "src/upload.ts", done: true },
  { concept: "Serving", question: "How is it served?", file: "src/clip-service.ts", done: false },
  { concept: "Startup", question: "Where does the app start?", file: "src/upload.ts", done: false },
];

function profile(goal: string | null) {
  return { level: "intermediate", mode: "teach", frequency: "normal", goal };
}

async function routeProfile(page: Page, goal: string | null) {
  await page.route("**/api/profile", (route) => route.fulfill({ json: profile(goal) }));
}

async function open(page: Page, goal: string | null) {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await routeProfile(page, goal);
  const planned: unknown[] = [];
  await page.route("**/api/path", (route) => {
    if (route.request().method() === "POST") {
      planned.push(route.request().postDataJSON());
      return route.fulfill({ json: { items } });
    }
    return route.fulfill({ json: null });
  });
  await page.goto("/");
  return planned;
}

test("Plan a learning path shows the path as a checklist card, and Next and each item ask their question", async ({
  page,
}) => {
  const planned = await open(page, "Add retries to uploads");
  const questions = countAsks(page);
  const panel = page.getByRole("complementary", { name: "Conversation panel" });

  await panel.getByRole("button", { name: "Plan a learning path" }).click();

  await expect.poll(() => planned).toEqual([{}]);
  const card = panel.getByRole("region", { name: "Learning path" });
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByRole("img", { name: "Done", exact: true })).toHaveCount(1);
  await expect(card.getByRole("img", { name: "Not done", exact: true })).toHaveCount(2);

  await card.getByRole("button", { name: "Next" }).click();
  await expect.poll(() => questions).toEqual(["How is it served?"]);

  await card.getByRole("button", { name: /Startup/ }).click();
  await expect.poll(() => questions).toEqual(["How is it served?", "Where does the app start?"]);
});

test("the welcome pane shows a saved path", async ({ page }) => {
  await page.route("**/api/path", (route) => route.fulfill({ json: { items } }));
  await routeProfile(page, null);
  await page.goto("/");

  const welcome = page.getByRole("region", { name: "Welcome" });
  await expect(welcome.getByRole("region", { name: "Learning path" })).toBeVisible();
});

test("with no goal, the tutor asks for one first and the next message becomes the goal", async ({
  page,
}) => {
  const planned = await open(page, null);
  const saved: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/api/profile")) {
      saved.push(request.postDataJSON());
    }
  });
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  await panel.getByRole("button", { name: "Plan a learning path" }).click();

  await expect(panel.getByText("What do you want to do with this repo?")).toBeVisible();
  expect(planned).toEqual([]);
  const box = page.getByLabel("Question");
  await box.fill("Add retries to uploads");
  await box.press("Enter");

  await expect.poll(() => planned).toEqual([{}]);
  expect(saved).toEqual([profile("Add retries to uploads")]);
  await expect(panel.getByRole("region", { name: "Learning path" })).toBeVisible();
});

test("asking a path item sends its concept, and the card ticks it once the tour has been played", async ({
  page,
}) => {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await routeProfile(page, "Add retries");
  let played = false;
  await page.route("**/api/played", (route) => {
    played = true;
    return route.continue();
  });
  await page.route("**/api/path", (route) =>
    route.fulfill({
      json: {
        items: items.map((item) => ({ ...item, done: item.concept === "Serving" && played })),
      },
    }),
  );
  await page.goto("/");
  const asked = bodiesPostedTo(page, "/api/ask");
  const card = page
    .getByRole("complementary", { name: "Conversation panel" })
    .getByRole("region", { name: "Learning path" });
  await expect(card.getByRole("img", { name: "Done", exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: /Serving/ }).click();

  await expect
    .poll(() => asked)
    .toEqual([{ question: "How is it served?", pathConcept: "Serving" }]);
  await expect(card.getByRole("img", { name: "Done", exact: true })).toHaveCount(1);
});

test("Plan a learning path waits while an ask runs", async ({ page }) => {
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
  await open(page, "Add retries");
  const panel = page.getByRole("complementary", { name: "Conversation panel" });
  const planButton = panel.getByRole("button", { name: "Plan a learning path" });
  const box = page.getByLabel("Question");
  await box.fill("How are clips saved?");
  await box.press("Enter");

  await expect(planButton).toBeDisabled();
  release();
  await expect(page.getByText("Hold on.")).toBeVisible();
  await expect(planButton).toBeEnabled();
});
