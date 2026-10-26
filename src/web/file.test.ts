import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFile } from "./file.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFile", () => {
  it("shows the server's error message", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "Path outside the repo" }, { status: 400 }),
    );

    await expect(fetchFile("../x.ts", "token")).rejects.toThrow("Path outside the repo");
  });

  it("falls back to the status when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));

    await expect(fetchFile("src/a.ts", "token")).rejects.toThrow(
      "Loading the file failed with status 500",
    );
  });
});
