import { expect, type Page, test } from "@playwright/test";

async function open(page: Page) {
  await page.addInitScript("speechSynthesis.getVoices = () => [];");
  await page.goto("/");
  await page.getByText("Explain my diff", { exact: true }).click();
}

function askRequest(page: Page) {
  return page.waitForRequest((request) => request.url().endsWith("/api/ask"));
}

test("Explain my diff sends the chosen base and the why, and shows why it can't start", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("Diff base").selectOption("branch");
  await page.getByLabel("Why (optional)").fill("Uploads need a bigger cap");
  const asked = askRequest(page);

  await page.getByRole("button", { name: "Explain this diff" }).click();

  const body = (await asked).postDataJSON();
  expect(body.question).toBe("Explain my diff (since the branch started)");
  expect(body.diff).toEqual({ base: "branch", why: "Uploads need a bigger cap" });
  await expect(page.getByRole("list", { name: "Conversation" })).toContainText(
    "Explain my diff (since the branch started)",
  );
  await expect(page.locator("li.note.error")).toBeVisible();
});

test("Explain my diff starts with uncommitted changes and no why by default", async ({ page }) => {
  await open(page);
  const asked = askRequest(page);

  await page.getByRole("button", { name: "Explain this diff" }).click();

  const body = (await asked).postDataJSON();
  expect(body.question).toBe("Explain my diff (uncommitted changes)");
  expect(body.diff).toEqual({ base: "uncommitted" });
});

const file = "src/clip-service.ts";
const before = "export class ClipService {\n  save() {\n    return 1;\n  }\n}\n";
const after = "export class ClipService {\n  save() {\n    return 2;\n  }\n  remove() {}\n}\n";

async function showDiffTour(
  page: Page,
  range: { start: number; end: number; side: "old" | "new" },
  versions = { before, after },
) {
  const step = {
    title: "The return value",
    anchors: [{ file, line: range.start, text: "return", side: range.side }],
    narration: [{ text: "The return value changed.", anchor: 0 }],
  };
  const shown = { type: "step", step, ranges: [{ file, ...range, capped: false }] };
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(shown)}\n\ndata: {"type":"done"}\n\n`,
    }),
  );
  const oldRequests: string[] = [];
  await page.route("**/api/file?*", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("side") === "old") oldRequests.push(url.search);
    const content = url.searchParams.get("side") === "old" ? versions.before : versions.after;
    return route.fulfill({ json: { path: file, content } });
  });
  await open(page);
  await page.getByLabel("Diff base").selectOption("snapshot");
  await page.getByRole("button", { name: "Explain this diff" }).click();
  return oldRequests;
}

test("a diff tour shows the old and new code side by side and highlights removed code on the old side", async ({
  page,
}) => {
  const oldRequests = await showDiffTour(page, { start: 3, end: 3, side: "old" });

  const oldSide = page.locator(".cm-merge-a");
  const newSide = page.locator(".cm-merge-b");
  await expect(oldSide.locator(".cm-line").nth(2)).toHaveClass(/cm-highlight-current/);
  await expect(oldSide).toContainText("return 1;");
  await expect(newSide).toContainText("return 2;");
  await expect(newSide.locator(".cm-highlight-current")).toHaveCount(0);
  expect(oldRequests).toEqual([`?path=${encodeURIComponent(file)}&side=old&base=snapshot`]);
});

test("a diff tour highlights new code on the new side", async ({ page }) => {
  await showDiffTour(page, { start: 3, end: 3, side: "new" });

  await expect(page.locator(".cm-merge-b .cm-line").nth(2)).toHaveClass(/cm-highlight-current/);
  await expect(page.locator(".cm-merge-a .cm-highlight-current")).toHaveCount(0);
});

test("a diff tour scrolls to a highlight far down a long file", async ({ page }) => {
  const long = (value: number) =>
    Array.from({ length: 200 }, (_, line) => `const line${line + 1} = ${value};`).join("\n");
  await showDiffTour(
    page,
    { start: 150, end: 150, side: "old" },
    { before: long(1), after: long(2) },
  );

  await expect(page.locator(".cm-merge-a .cm-highlight-current")).toBeInViewport();
});
