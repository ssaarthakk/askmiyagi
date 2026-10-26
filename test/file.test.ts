import { randomUUID } from "node:crypto";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileResponseSchema } from "../src/shared/file.ts";
import { requestPath, root, startServer } from "./cli-harness.ts";

const fixture = join(root, "test", "fixtures", "basic");

function getFile(url: string, token: string, path: string) {
  return requestPath(url, `/api/file?path=${encodeURIComponent(path)}`, {
    "x-miyagi-token": token,
  });
}

describe("GET /api/file", () => {
  it("returns the path and content of a visible file", async () => {
    const { url, token } = await startServer(fixture);

    const response = await getFile(url, token, "src/clip-service.ts");

    expect(response.status).toBe(200);
    expect(fileResponseSchema.parse(JSON.parse(response.body))).toEqual({
      path: "src/clip-service.ts",
      content: await readFile(join(fixture, "src", "clip-service.ts"), "utf8"),
    });
  });

  it("requires the session token", async () => {
    const { url } = await startServer(fixture);

    await expect(requestPath(url, "/api/file?path=src%2Fclip-service.ts")).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
  });

  it("refuses paths the guard or the filter reject with a 400 error", async () => {
    const { url, token } = await startServer(fixture);

    for (const path of ["../package.json", "src/missing.ts", "src/schema.gen.ts", ""]) {
      const response = await getFile(url, token, path);
      expect(response.status).toBe(400);
      expect(JSON.parse(response.body)).toEqual({ error: expect.any(String) });
    }
    const missingParameter = await requestPath(url, "/api/file", { "x-miyagi-token": token });
    expect(missingParameter.status).toBe(400);
  });

  it("redacts secrets in the returned content", async () => {
    const folder = join(tmpdir(), `miyagi-file-${randomUUID()}`);
    await cp(fixture, folder, { recursive: true });
    await writeFile(
      join(folder, "src", "leak.ts"),
      "export const key = 'sk-ant-abcdefghijklmnopqrstuvwxyz1234567890';\n",
    );
    try {
      const { url, token } = await startServer(folder);

      const response = await getFile(url, token, "src/leak.ts");

      expect(response.status).toBe(200);
      expect(response.body).toContain("[REDACTED]");
      expect(response.body).not.toContain("sk-ant-");
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
