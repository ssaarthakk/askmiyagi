import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { terminal } from "../../test/ask-helpers.ts";
import type { SessionRecord } from "../shared/session.ts";
import { writeSessionRecord } from "./session-record.ts";

const session: SessionRecord = {
  startedAt: "2026-11-01T10:00:00.000Z",
  summary: null,
  turns: [{ question: "How are clips saved?", record: "Tour: Saving a clip." }],
};

const temporaryFolders: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

async function makeFolders() {
  const parent = await mkdtemp(join(tmpdir(), "miyagi-session-record-"));
  temporaryFolders.push(parent);
  const root = join(parent, "project");
  await mkdir(root);
  return { root };
}

function sessionFile(root: string) {
  return join(root, ".tutor", "private", "session.json");
}

describe("writeSessionRecord", () => {
  it("writes the session as JSON to .tutor/private/session.json", async () => {
    const { root } = await makeFolders();

    await writeSessionRecord(root, session);

    expect(JSON.parse(await readFile(sessionFile(root), "utf8"))).toEqual(session);
  });

  it("replaces the earlier session instead of adding to it", async () => {
    const { root } = await makeFolders();
    const later: SessionRecord = {
      ...session,
      summary: "They asked about clips.",
      turns: [{ question: "Why?", record: "Replied: Because." }],
    };

    await writeSessionRecord(root, session);
    await writeSessionRecord(root, later);

    expect(JSON.parse(await readFile(sessionFile(root), "utf8"))).toEqual(later);
  });

  it("writes nothing for a session that breaks the schema, and says what is wrong", async () => {
    const { root } = await makeFolders();
    const printed = terminal();

    await writeSessionRecord(root, { ...session, startedAt: "yesterday" });

    await expect(readFile(sessionFile(root), "utf8")).rejects.toThrow(/ENOENT/);
    expect(printed()).toMatch(/^miyagi: Session not saved: startedAt/);
  });
});
