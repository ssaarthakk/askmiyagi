import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../test/ask-helpers.ts";
import type { CallRecord } from "../shared/call-log.ts";
import { addFirstSound, appendCallLog } from "./call-log.ts";

const record: CallRecord = {
  callType: "ask",
  provider: "fake",
  mode: "brute-force",
  startedAt: "2026-10-31T10:00:00.000Z",
  ackMs: 1,
  firstContentMs: 20,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 2,
  cacheWriteTokens: 3,
  costUsd: null,
  filesOpened: ["src/upload.ts", ".env"],
  outcome: "done",
};

const temporaryFolders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function makeFolders() {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-call-log-"));
  temporaryFolders.push(parent);
  const root = join(parent, "project");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  return { root, outside };
}

describe("appendCallLog", () => {
  it("writes one JSON line per call to .tutor/private/calls.jsonl", async () => {
    const { root } = await makeFolders();

    await appendCallLog(root, record);
    await appendCallLog(root, { ...record, outcome: "error" });

    const text = await readFile(join(root, ".tutor", "private", "calls.jsonl"), "utf8");
    const written = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(written).toEqual([record, { ...record, outcome: "error" }]);
  });

  it("keeps the log out of git but not the tours", async () => {
    const { root } = await makeFolders();
    execFileSync("git", ["init", "--quiet"], { cwd: root });

    await appendCallLog(root, record);
    await mkdir(join(root, ".tutor", "tours"));
    await writeFile(join(root, ".tutor", "tours", "a.json"), "{}");

    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(status).toContain("?? .tutor/.gitignore");
    expect(status).toContain("?? .tutor/tours/a.json");
    expect(status).not.toContain("calls.jsonl");
  });

  it.each([
    { link: ".tutor", name: ".tutor" },
    { link: join(".tutor", "private"), name: ".tutor/private" },
  ])("logs nothing when $name is a link to another folder", async ({ link }) => {
    const { root, outside } = await makeFolders();
    if (link !== ".tutor") await mkdir(join(root, ".tutor"));
    await symlink(outside, join(root, link), "junction");
    const printed = terminal();

    await appendCallLog(root, record);

    await expect(readdir(outside)).resolves.toEqual([]);
    expect(printed()).toMatch(/^miyagi: .*\.tutor/);
    expect(printed().trim().split("\n")).toHaveLength(1);
  });

  it("logs one line and does not fail when the write throws", async () => {
    const { root } = await makeFolders();
    await rm(root, { recursive: true });
    const printed = terminal();

    await expect(appendCallLog(root, record)).resolves.toBeUndefined();

    expect(printed()).toMatch(/^miyagi: Call not logged: /);
    expect(printed().trim().split("\n")).toHaveLength(1);
  });

  it("logs nothing when calls.jsonl is a link to another file", async ({ skip }) => {
    const { root, outside } = await makeFolders();
    await mkdir(join(root, ".tutor", "private"), { recursive: true });
    const target = join(outside, "stolen.jsonl");
    await writeFile(target, "");
    try {
      await symlink(target, join(root, ".tutor", "private", "calls.jsonl"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }
    const printed = terminal();

    await appendCallLog(root, record);

    expect(await readFile(target, "utf8")).toBe("");
    expect(printed()).toContain("calls.jsonl");
  });
});

describe("addFirstSound", () => {
  async function lines(root: string) {
    const text = await readFile(join(root, ".tutor", "private", "calls.jsonl"), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  it("adds the time to the last call and leaves earlier calls alone", async () => {
    const { root } = await makeFolders();
    await appendCallLog(root, record);
    await appendCallLog(root, { ...record, outcome: "error" });

    await addFirstSound(root, 850);

    expect(await lines(root)).toEqual([record, { ...record, outcome: "error", firstSoundMs: 850 }]);
  });

  it("keeps every call appended while the first sound is being added", async () => {
    const { root } = await makeFolders();
    await appendCallLog(root, record);
    const rubric: CallRecord = { ...record, callType: "rubric", filesOpened: [] };

    await Promise.all([
      addFirstSound(root, 850),
      ...Array.from({ length: 20 }, () => appendCallLog(root, rubric)),
    ]);

    const written = await lines(root);
    expect(written).toHaveLength(21);
    expect(written.filter((call) => call.firstSoundMs === 850)).toHaveLength(1);
  });

  it("skips the small-model calls logged after the ask", async () => {
    const { root } = await makeFolders();
    const rubric: CallRecord = { ...record, callType: "rubric", filesOpened: [] };
    await appendCallLog(root, record);
    await appendCallLog(root, rubric);
    await appendCallLog(root, { ...rubric, callType: "summary" });

    await addFirstSound(root, 850);

    expect(await lines(root)).toEqual([
      { ...record, firstSoundMs: 850 },
      rubric,
      { ...rubric, callType: "summary" },
    ]);
  });

  it("logs one line and keeps the log when its last line is not a call", async () => {
    const { root } = await makeFolders();
    await appendCallLog(root, record);
    const file = join(root, ".tutor", "private", "calls.jsonl");
    await writeFile(file, `${await readFile(file, "utf8")}not json\n`);
    const printed = terminal();

    await addFirstSound(root, 850);

    expect(printed()).toMatch(/^miyagi: First sound not logged: /);
    expect(printed().trim().split("\n")).toHaveLength(1);
    expect((await readFile(file, "utf8")).endsWith("not json\n")).toBe(true);
  });

  it("logs one line and does not fail when no call was logged yet", async () => {
    const { root } = await makeFolders();
    const printed = terminal();

    await expect(addFirstSound(root, 850)).resolves.toBeUndefined();

    expect(printed()).toMatch(/^miyagi: First sound not logged: /);
    expect(printed().trim().split("\n")).toHaveLength(1);
  });

  it("writes nothing when calls.jsonl is a link to another file", async ({ skip }) => {
    const { root, outside } = await makeFolders();
    await mkdir(join(root, ".tutor", "private"), { recursive: true });
    const target = join(outside, "stolen.jsonl");
    await writeFile(
      target,
      `${JSON.stringify(record)}
`,
    );
    try {
      await symlink(target, join(root, ".tutor", "private", "calls.jsonl"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }
    const printed = terminal();

    await addFirstSound(root, 850);

    expect(await readFile(target, "utf8")).toBe(`${JSON.stringify(record)}
`);
    expect(printed()).toContain("calls.jsonl");
  });
});
