import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requestPath, root, sourceCli, startCli, startServer, waitForExit } from "./cli-harness.ts";

const fixture = join(root, "test", "fixtures", "monorepo");

function getFile(url: string, token: string, path: string) {
  return requestPath(url, `/api/file?path=${encodeURIComponent(path)}`, {
    "x-miyagi-token": token,
  });
}

describe("monorepo CLI", () => {
  it("serves only the chosen app and the root config files", async () => {
    const { url, token } = await startServer(fixture, ["--app", "apps/web"]);

    expect((await getFile(url, token, "apps/web/src/page.ts")).status).toBe(200);
    expect((await getFile(url, token, "tsconfig.json")).status).toBe(200);
    expect((await getFile(url, token, "apps/api/src/server.ts")).status).toBe(400);
    expect((await getFile(url, token, "README.md")).status).toBe(400);
  });

  it("exits 1 with the list of apps when no app is chosen and stdin is not a terminal", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0", fixture]);

    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr).toContain("--app");
    expect(childProcess.stderr).toContain("apps/api");
    expect(childProcess.stderr).toContain("apps/web");
  });
});
