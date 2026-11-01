import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestPath, root, startServer } from "./cli-harness.ts";

const fixture = join(root, "test", "fixtures", "basic");

describe("GET /api/symbols", () => {
  it("lists the unique declared names of the visible source files, sorted", async () => {
    const { url, token } = await startServer(fixture);

    const response = await requestPath(url, "/api/symbols", { "x-miyagi-token": token });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ symbols: ["ClipService", "save", "uploadClip"] });
  });

  it("requires the session token", async () => {
    const { url } = await startServer(fixture);

    await expect(requestPath(url, "/api/symbols")).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
  });
});
