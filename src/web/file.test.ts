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

describe("fetchFile with a base", () => {
  it("asks for the old side of the file against the base", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return Response.json({ path: "src/a b.ts", content: "old" });
    });

    await expect(fetchFile("src/a b.ts", "token", "branch")).resolves.toBe("old");
    expect(urls).toEqual(["/api/file?path=src%2Fa%20b.ts&side=old&base=branch"]);
  });

  it("shows the server's error message", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "No snapshot" }, { status: 400 }));

    await expect(fetchFile("src/a.ts", "token", "snapshot")).rejects.toThrow("No snapshot");
  });
});
