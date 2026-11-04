import { cp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceCli, startCli, waitForLine } from "./cli-harness.ts";
import { commitAll, git, githubRemoteConfig } from "./git-helpers.ts";
import { tempDir } from "./temp-dir.ts";

const profile = { level: "beginner", mode: "teach", frequency: "light", goal: "Learn the upload" };

describe("a GitHub URL source", () => {
  it("keeps the call log, session record and profile in ~/.askmiyagi, not in the temp clone", async () => {
    const work = await tempDir();
    await cp("test/fixtures/basic", work, { recursive: true });
    git(work, "init", "-q", "-b", "main");
    commitAll(work, "first");
    const bare = join(await tempDir(), "remote.git");
    git(work, "clone", "-q", "--bare", work, bare);
    const globalConfig = await githubRemoteConfig(bare);
    const home = await tempDir();
    const cli = startCli(
      sourceCli,
      [
        "--no-open",
        "--port",
        "0",
        "--provider",
        "fake",
        "--recording",
        "test/fixtures/recordings/ask-tour.jsonl",
        "https://github.com/octo/remote",
      ],
      undefined,
      {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    );
    const url = await waitForLine(cli);
    const token = (await (await fetch(url)).text()).match(
      /<meta name="miyagi-token" content="([a-f0-9]{64})">/,
    )?.[1];
    const headers = { "x-miyagi-token": token ?? "", "content-type": "application/json" };

    const asked = await fetch(new URL("/api/ask", url), {
      method: "POST",
      headers,
      body: JSON.stringify({ question: "How are clips saved?" }),
    });
    await asked.text();
    const sounded = await fetch(new URL("/api/first-sound", url), {
      method: "POST",
      headers,
      body: JSON.stringify({ ms: 850 }),
    });
    const saved = await fetch(new URL("/api/profile", url), {
      method: "PUT",
      headers,
      body: JSON.stringify(profile),
    });

    expect(sounded.status).toBe(204);
    expect(saved.status).toBe(200);
    const store = join(home, ".askmiyagi", "octo-remote", ".tutor", "private");
    expect((await readdir(store)).toSorted()).toEqual([
      "calls.jsonl",
      "profile.json",
      "session.json",
    ]);
    expect(JSON.parse(await readFile(join(store, "profile.json"), "utf8"))).toEqual(profile);
    const calls = (await readFile(join(store, "calls.jsonl"), "utf8")).trim().split("\n");
    expect(JSON.parse(calls.at(-1) ?? "")).toEqual(expect.objectContaining({ firstSoundMs: 850 }));
  }, 30_000);
});
