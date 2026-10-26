import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  nonLoopbackIPv4,
  requestPath,
  root,
  sourceCli,
  startCli,
  startServer,
  waitForExit,
  waitForLine,
} from "./cli-harness.ts";

describe("local server", () => {
  it("serves the page with a fresh session token inserted before the closing head tag", async () => {
    const first = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const firstUrl = await waitForLine(first);
    const firstResponse = await fetch(firstUrl);
    const firstHtml = await firstResponse.text();
    const firstToken = firstHtml.match(/<meta name="miyagi-token" content="([a-f0-9]{64})">/);

    const second = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const secondUrl = await waitForLine(second);
    const secondHtml = await (await fetch(secondUrl)).text();
    const secondToken = secondHtml.match(/<meta name="miyagi-token" content="([a-f0-9]{64})">/);

    expect(firstResponse.status).toBe(200);
    expect(firstToken).not.toBeNull();
    expect(firstHtml.indexOf(firstToken?.[0] ?? "")).toBeLessThan(firstHtml.indexOf("</head>"));
    expect(secondToken).not.toBeNull();
    expect(secondToken?.[1]).not.toBe(firstToken?.[1]);
  });

  it("serves static assets with the content type for each supported extension", async () => {
    const webRoot = join(root, "dist", "web");
    const directory = join(webRoot, `test-${randomUUID()}`);
    const assets: [string, string][] = [
      ["page.html", "text/html; charset=utf-8"],
      ["app.js", "text/javascript"],
      ["app.css", "text/css"],
      ["icon.svg", "image/svg+xml"],
      ["data.json", "application/json"],
      ["module.wasm", "application/wasm"],
      ["font.woff2", "font/woff2"],
      ["unknown.bin", "application/octet-stream"],
    ];
    await mkdir(directory);
    await Promise.all(assets.map(([name]) => writeFile(join(directory, name), name)));

    try {
      const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
      const url = await waitForLine(childProcess);
      const assetPath = directory.slice(webRoot.length).replaceAll("\\", "/");
      for (const [name, contentType] of assets) {
        const response = await fetch(new URL(`${assetPath}/${name}`, url));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(contentType);
        await expect(response.text()).resolves.toBe(name);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns the not found response for missing and escaping asset paths", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);
    await expect(fetch(new URL("/missing.js", url))).resolves.toMatchObject({ status: 404 });
    await expect(requestPath(url, "/%2e%2e/%2e%2e/package.json")).resolves.toEqual({
      status: 404,
      body: "Not found",
    });
    await expect(requestPath(url, "/%00")).resolves.toEqual({ status: 404, body: "Not found" });
  });

  it("rejects requests with an untrusted host using a JSON error", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);
    const address = new URL(url);

    await expect(requestPath(url, "/", { host: `example.com:${address.port}` })).resolves.toEqual({
      status: 403,
      body: '{"error":"Forbidden host"}',
    });
  });

  it("accepts localhost as a host and origin", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);
    const address = new URL(url);
    const response = await requestPath(url, "/", {
      host: `localhost:${address.port}`,
      origin: `http://localhost:${address.port}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toContain('<meta name="miyagi-token" content=');
  });

  it.skipIf(!nonLoopbackIPv4)("listens only on the loopback interface", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);
    const address = new URL(url);

    await expect(
      requestPath(`http://${nonLoopbackIPv4}:${address.port}/`, "/"),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("rejects requests with an untrusted origin using a JSON error", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);

    await expect(requestPath(url, "/", { origin: "https://example.com" })).resolves.toEqual({
      status: 403,
      body: '{"error":"Forbidden origin"}',
    });
  });

  it("requires the page session token for API requests", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const url = await waitForLine(childProcess);
    const page = await (await fetch(url)).text();
    const token = page.match(/<meta name="miyagi-token" content="([a-f0-9]{64})">/)?.[1];
    expect(token).toBeDefined();

    await expect(requestPath(url, "/api/example")).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
    await expect(requestPath(url, "/api/example", { "x-miyagi-token": "wrong" })).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
    await expect(requestPath(url, "/%61pi/example")).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
    await expect(
      requestPath(url, "/api/example", { "x-miyagi-token": token ?? "" }),
    ).resolves.toEqual({ status: 404, body: "Not found" });
  });

  it("answers 404 for /api/speech with the browser voice and 401 without the token", async () => {
    const { url, token } = await startServer("test/fixtures/basic", [], {
      ...process.env,
      ELEVENLABS_API_KEY: "test-key",
    });

    await expect(requestPath(url, "/api/speech", {}, "POST")).resolves.toEqual({
      status: 401,
      body: '{"error":"Unauthorized"}',
    });
    await expect(
      requestPath(url, "/api/speech", { "x-miyagi-token": token }, "POST"),
    ).resolves.toEqual({ status: 404, body: '{"error":"Not found"}' });
  });

  it("serves the elevenlabs voice and /api/speech when started with the elevenlabs voice and a key", async () => {
    const { url, token } = await startServer("test/fixtures/basic", ["--voice", "elevenlabs"], {
      ...process.env,
      ELEVENLABS_API_KEY: "test-key",
    });

    expect(await (await fetch(url)).text()).toContain(
      '<meta name="miyagi-voice" content="elevenlabs">',
    );
    await expect(
      requestPath(url, "/api/speech", { "x-miyagi-token": token }, "POST"),
    ).resolves.toEqual({ status: 400, body: '{"error":"Request body is not valid JSON"}' });
  });

  it("prints the build instruction and exits if the built page is missing", async () => {
    const copy = join(root, "dist", `missing-build-${randomUUID()}`);
    await cp(join(root, "src"), join(copy, "src"), { recursive: true });

    try {
      const copiedCli = join(copy, "src", "server", "cli.ts");
      const childProcess = startCli(copiedCli, ["--no-open", "--port", "0"]);
      await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
      expect(childProcess.stderr.trim()).toBe("Run npm run build first");
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });
});
