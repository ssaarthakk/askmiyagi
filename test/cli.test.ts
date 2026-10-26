import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCliArgs, speechOptions } from "../src/server/cli.ts";
import { builtCli, root, sourceCli, startCli, waitForExit, waitForLine } from "./cli-harness.ts";

describe("CLI entry", () => {
  it("defaults to the current folder and prints one URL on a free port", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    const line = await waitForLine(childProcess);
    expect(line).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(childProcess.stdout.trim().split(/\r?\n/)).toEqual([line]);
    const address = new URL(line);
    expect(address.port).not.toBe("0");
    expect(childProcess.stderr).toBe("");
    const response = await fetch(line);
    expect(response.url).toBe(line);
  });

  it.skipIf(process.platform === "win32")("closes cleanly on Ctrl+C", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"]);
    await waitForLine(childProcess);
    childProcess.child.kill("SIGINT");
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 0 });
  });

  it("reports a missing folder and exits with status 1", async () => {
    const missing = join(tmpdir(), `miyagi-missing-${randomUUID()}`);
    const childProcess = startCli(sourceCli, ["--no-open", missing]);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe(`Folder not found: ${missing}`);
  });

  it("reports a file path and exits with status 1", async () => {
    const folder = await mkdtemp(join(tmpdir(), "miyagi-file-"));
    const file = join(folder, "file.ts");
    try {
      await writeFile(file, "export const value = 1;\n");
      const childProcess = startCli(sourceCli, ["--no-open", file]);
      await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
      expect(childProcess.stderr.trim()).toBe(`Not a folder: ${file}`);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("starts from the compiled package entry", async () => {
    const childProcess = startCli(builtCli, ["--no-open", "--port", "0", "test/fixtures/basic"]);
    const line = await waitForLine(childProcess);
    expect(line).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const response = await fetch(line);
    expect(response.status).toBe(200);
    expect(response.url).toBe(line);
    expect(await response.text()).toMatch(/<meta name="miyagi-token" content="[a-f0-9]{64}">/);
  });
});

describe("hidden fake provider flags", () => {
  const recording = "test/fixtures/recordings/tour.jsonl";

  it("starts with a valid recording", async () => {
    const childProcess = startCli(sourceCli, [
      "--no-open",
      "--port",
      "0",
      "--provider",
      "fake",
      "--recording",
      recording,
    ]);
    const line = await waitForLine(childProcess);
    expect(line).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(childProcess.stderr).toBe("");
  });

  it("needs a recording for the fake provider", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--provider", "fake"]);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("--provider fake needs --recording <file>");
  });

  it("rejects a recording without the fake provider", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--recording", recording]);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("--recording only works with --provider fake");
  });

  it("rejects an unknown provider", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--provider", "nope"]);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("Unknown provider: nope");
  });

  it("reports an invalid recording and exits with status 1", async () => {
    const childProcess = startCli(sourceCli, [
      "--no-open",
      "--provider",
      "fake",
      "--recording",
      "test/fixtures/recordings/invalid.jsonl",
    ]);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr).toContain("line 2");
  });
});

describe("voice flags", () => {
  const withoutKey = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "ELEVENLABS_API_KEY"),
  );

  it("serves the browser voice by default", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--port", "0"], root, withoutKey);
    const page = await (await fetch(await waitForLine(childProcess))).text();
    expect(page).toContain('<meta name="miyagi-voice" content="browser">');
  });

  it("refuses elevenlabs without the key", async () => {
    const childProcess = startCli(
      sourceCli,
      ["--no-open", "--voice", "elevenlabs"],
      root,
      withoutKey,
    );
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("Set ELEVENLABS_API_KEY to use --voice elevenlabs");
  });

  it("rejects an unknown voice", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--voice", "nope"], root, withoutKey);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("Unknown voice: nope");
  });

  it("rejects an empty voice id", async () => {
    const childProcess = startCli(sourceCli, ["--no-open", "--voice-id", ""], root, withoutKey);
    await expect(waitForExit(childProcess.child)).resolves.toMatchObject({ code: 1 });
    expect(childProcess.stderr.trim()).toBe("--voice-id must not be empty");
  });
});

describe("voice options", () => {
  it("defaults to the browser voice with a premade ElevenLabs voice id", () => {
    const options = parseCliArgs([]);
    expect(options.voice).toBe("browser");
    expect(options.voiceId).toMatch(/^\w{10,}$/);
  });

  it("takes the voice and voice id from the flags", () => {
    expect(parseCliArgs(["--voice", "elevenlabs", "--voice-id", "abc123"])).toMatchObject({
      voice: "elevenlabs",
      voiceId: "abc123",
    });
  });

  it("hands the chosen voice id and the key to the speech route with the elevenlabs voice", () => {
    const options = parseCliArgs(["--voice", "elevenlabs", "--voice-id", "abc123"]);
    expect(speechOptions(options, { ELEVENLABS_API_KEY: "test-key" })).toEqual({
      apiKey: "test-key",
      voiceId: "abc123",
    });
  });

  it("keeps the key from the speech route with the browser voice", () => {
    const options = parseCliArgs(["--voice-id", "abc123"]);
    expect(speechOptions(options, { ELEVENLABS_API_KEY: "test-key" })).toEqual({
      apiKey: undefined,
      voiceId: "abc123",
    });
  });
});
