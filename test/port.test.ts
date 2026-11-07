import { createServer, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { defaultPort } from "../src/server/cli-args.ts";
import { sourceCli, startCli, waitForExit, waitForLine } from "./cli-harness.ts";

function listen(server: Server, port: number) {
  return new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
}

function close(server: Server) {
  return new Promise((resolve) => server.close(resolve));
}

describe("server port", () => {
  it("starts on the same port every time, so the browser keeps the downloaded voice model", async ({
    skip,
  }) => {
    const probe = createServer();
    if (!(await listen(probe, defaultPort))) skip(`port ${defaultPort} is in use`);
    await close(probe);

    const line = await waitForLine(startCli(sourceCli, ["--no-open"]));

    expect(line).toBe(`http://127.0.0.1:${defaultPort}/`);
  });

  it("falls back to a free port with a warning when the usual port is busy", async () => {
    const blocker = createServer();
    const blocking = await listen(blocker, defaultPort);
    try {
      const childProcess = startCli(sourceCli, ["--no-open"]);
      const line = await waitForLine(childProcess);

      expect(new URL(line).port).not.toBe(String(defaultPort));
      await vi.waitFor(() =>
        expect(childProcess.stderr).toContain(
          `Port ${defaultPort} is not available, so the browser cannot reuse the voice models it downloaded before`,
        ),
      );
    } finally {
      if (blocking) await close(blocker);
    }
  });

  it("refuses to start when the port chosen with --port is busy", async () => {
    const blocker = createServer();
    await listen(blocker, 0);
    const { port } = blocker.address() as { port: number };
    try {
      const childProcess = startCli(sourceCli, ["--no-open", "--port", String(port)]);

      await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
      expect(childProcess.stderr).toContain("Could not start server");
    } finally {
      await close(blocker);
    }
  });
});
