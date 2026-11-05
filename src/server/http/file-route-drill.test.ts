import { afterEach, describe, expect, it } from "vitest";
import { listen, writePathProject } from "../../../test/path-project.ts";
import { clearOverlay, setOverlay } from "../files/overlay.ts";
import { createFileHandler } from "./file-route.ts";

afterEach(() => {
  clearOverlay();
});

async function content(query: string) {
  const root = await writePathProject();
  setOverlay(root, "src/store.ts", "export const read = 0;");
  const base = await listen((request, response) => void createFileHandler(root)(request, response));
  const response = await fetch(`${base}/api/file?${query}`);
  return { status: response.status, body: await response.json() };
}

describe("GET /api/file during a drill", () => {
  it("returns the real file as the old side of the drill base", async () => {
    const { body } = await content("path=src%2Fstore.ts&side=old&base=drill");

    expect(body).toEqual({ path: "src/store.ts", content: "export const read = 1;" });
  });
});
