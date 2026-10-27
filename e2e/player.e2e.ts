import { expect, test } from "@playwright/test";
import { ask } from "./ask.ts";

const range = { file: "src/upload.ts", start: 1, end: 1, capped: false };

function step(title: string, text: string) {
  return {
    title,
    anchors: [{ file: "src/upload.ts", symbol: "uploadClip" }],
    narration: [{ text, anchor: 0 }],
  };
}

function sse(...events: object[]) {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: {"type":"done"}\n\n`;
}

test("the tour lists steps and their segments with the first segment current", async ({ page }) => {
  await ask(page);

  const player = page.getByRole("region", { name: "Tour" });
  await expect(player.getByRole("heading", { name: "Project setup" })).toBeVisible();
  await expect(player.getByRole("heading", { name: "Saving a clip" })).toBeVisible();
  await expect(player.getByRole("heading", { name: "Uploading" })).toBeVisible();
  await expect(
    player.getByRole("button", { name: "The project is called basic." }),
  ).toHaveAttribute("aria-current", "true");
  await expect(player.getByRole("button", { name: "It depends on zod." })).not.toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("clicking segment 2 highlights its lines and dims segment 1's", async ({ page }) => {
  await ask(page);
  const lines = page.locator(".cm-line");
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-current/);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

  await page.getByRole("button", { name: "It depends on zod." }).click();

  await expect(lines.nth(7)).toHaveClass(/cm-highlight-current/);
  await expect(lines.nth(1)).toHaveClass(/cm-highlight-previous/);
  await expect(page.getByRole("button", { name: "It depends on zod." })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("a segment with no anchor highlights the step's first anchor", async ({ page }) => {
  await ask(page);

  await page.getByRole("button", { name: "Then the clip is uploaded." }).click();

  await expect(page.getByText("src/upload.ts", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-highlight-current").first()).toContainText("uploadClip");
});

test("Next and Previous move between segments and stop at the ends", async ({ page }) => {
  await ask(page);
  const next = page.getByRole("button", { name: "Next" });
  const previous = page.getByRole("button", { name: "Previous" });
  await expect(previous).toBeDisabled();

  await next.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "It depends on zod." })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await next.click();
  await expect(page.getByRole("button", { name: "Clips are saved here." })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByText("src/clip-service.ts", { exact: true })).toBeVisible();
  await next.click();
  await expect(next).toBeDisabled();

  await previous.click();
  await expect(page.getByRole("button", { name: "Clips are saved here." })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("a step is listed as soon as its step event arrives", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: sse({
        type: "step",
        step: step("Streamed", "Streamed words"),
        ranges: [range],
      }),
    }),
  );
  await ask(page);

  await expect(page.getByRole("heading", { name: "Streamed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Streamed words" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("a segment clicked while steps stream in survives the tour event", async ({ page }) => {
  const twoSegments = {
    title: "Streamed",
    anchors: [{ file: "src/upload.ts", symbol: "uploadClip" }],
    narration: [
      { text: "First words", anchor: 0 },
      { text: "Second words", anchor: 0 },
    ],
  };
  await page.addInitScript(`
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).includes("/api/ask")) return realFetch(input, init);
      const stream = new ReadableStream({
        start(controller) {
          window.pushToStream = (text) => controller.enqueue(new TextEncoder().encode(text));
        },
      });
      return Promise.resolve(
        new Response(stream, { headers: { "content-type": "text/event-stream" } }),
      );
    };
  `);
  const push = (event: object) =>
    page.evaluate(
      `window.pushToStream(${JSON.stringify(`data: ${JSON.stringify(event)}

`)})`,
    );
  await ask(page);

  await expect.poll(() => page.evaluate('"pushToStream" in window')).toBe(true);
  await push({ type: "step", step: twoSegments, ranges: [range] });
  await page.getByRole("button", { name: "Second words" }).click();
  await push({ type: "step", step: step("Later", "Later words"), ranges: [range] });
  await push({
    type: "tour",
    tour: { question: "q", steps: [twoSegments, step("Later", "Later words")] },
    ranges: [[range], [range]],
  });
  await push({ type: "done" });

  await expect(page.getByRole("button", { name: "Later words" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Second words" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("the tour event replaces the streamed steps", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: sse(
        { type: "step", step: step("Streamed", "Streamed words"), ranges: [range] },
        {
          type: "tour",
          tour: { question: "q", steps: [step("Replaced", "Replaced words")] },
          ranges: [[range]],
        },
      ),
    }),
  );
  await ask(page);

  await expect(page.getByRole("heading", { name: "Replaced" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Streamed" })).toHaveCount(0);
});

test("a second ask clears the old tour's code until its own tour arrives", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asks = 0;
  await page.route("**/api/ask", async (route) => {
    asks += 1;
    if (asks === 1) return route.continue();
    await gate;
    await route.fulfill({ contentType: "text/event-stream", body: sse() });
  });
  await ask(page);
  await expect(page.getByRole("region", { name: "Code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();

  await page.getByLabel("Question").press("Enter");

  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Code" })).toHaveCount(0);
  release();
});
