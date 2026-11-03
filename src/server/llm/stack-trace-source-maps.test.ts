import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitAll, createRepo } from "../../../test/git-helpers.ts";
import {
  anchor,
  createFiles,
  createProject,
  generated,
  sourceMap,
  users,
} from "../../../test/stack-trace-project.ts";
import { formatStackTrace } from "./stack-trace.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function terminalOutput() {
  const terminal = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return () => terminal.mock.calls.map(([text]) => String(text)).join("");
}

describe("anchorStackTrace with source maps", () => {
  it("never reads a sourceMappingURL that is not a .map file", async () => {
    const root = await createProject({
      ".env": "TOKEN=hunter2\n",
      "dist/index.js": "function getUser(id){return 1}\n//# sourceMappingURL=../.env\n",
    });
    const printed = terminalOutput();

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toMatchObject({ file: "/ci/build/dist/index.js" });
    expect(printed()).not.toContain("hunter2");
  });

  it("never prints the contents of a source map that is not valid JSON", async () => {
    const root = await createProject({ "dist/index.js.map": "hunter2 is not JSON" });
    const printed = terminalOutput();

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toMatchObject({ file: "/ci/build/dist/index.js" });
    expect(printed()).toContain("not valid JSON");
    expect(printed()).not.toContain("hunter2");
  });

  it("follows a source map to the original file and line, and never shows its contents", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "src/users.ts",
      line: 3,
      column: 5,
    });
    const text = formatStackTrace(anchored);
    expect(text).not.toContain("TOPSECRET");
    expect(text).not.toContain("index.js.map");
  });

  it("never reads a source map outside the project", async () => {
    const root = await createProject({
      "dist/index.js": "function getUser(id){return 1}\n//# sourceMappingURL=../../outside.map\n",
    });
    await writeFile(join(root, "..", "outside.map"), sourceMap);

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "/ci/build/dist/index.js",
      line: 1,
      column: 29,
    });
  });

  it("applies the source map's sourceRoot to find the original file", async () => {
    const root = await createProject({
      "dist/index.js.map": JSON.stringify({
        version: 3,
        file: "index.js",
        sourceRoot: "../src/",
        sources: ["users.ts"],
        names: [],
        mappings: "4BAEI",
      }),
    });

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "src/users.ts",
      line: 3,
      column: 5,
    });
  });

  it("follows a source map whose sourcesContent has null entries", async () => {
    const root = await createProject({
      "dist/index.js.map": JSON.stringify({ ...JSON.parse(sourceMap), sourcesContent: [null] }),
    });

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "src/users.ts",
      line: 3,
      column: 5,
    });
  });

  it("follows a source map in a gitignored dist folder of a git repo", async () => {
    const root = await createRepo();
    await createFiles(root, {
      ".gitignore": "dist/\n",
      "src/users.ts": users,
      "dist/index.js": generated,
      "dist/index.js.map": sourceMap,
    });
    commitAll(root, "add users");

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "src/users.ts",
      line: 3,
      column: 5,
    });
    expect(formatStackTrace(anchored)).not.toContain("TOPSECRET");
  });

  it("keeps going when the source map is not valid JSON", async () => {
    const root = await createProject({ "dist/index.js.map": '{"version": 3, "sources": [' });

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "/ci/build/dist/index.js",
      line: 1,
      column: 29,
    });
    expect(anchored.items[1]).toMatchObject({ file: "src/users.ts" });
  });

  it("keeps going when the sourceMappingURL has a bad percent-escape", async () => {
    const root = await createProject({
      "dist/index.js": "function getUser(id){return 1}\n//# sourceMappingURL=%E0%A4%A.map\n",
    });

    const anchored = await anchor(
      root,
      "getUser (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toMatchObject({ file: "/ci/build/dist/index.js" });
    expect(anchored.items[1]).toMatchObject({ file: "src/users.ts" });
  });

  it("never follows a source map from a hidden file that is not a script", async () => {
    const root = await createProject({
      ".env": "SECRET=1\n//# sourceMappingURL=dist/index.js.map\n",
    });

    const anchored = await anchor(root, "getUser (/app/.env:1:29)", "x (/ci/src/users.ts:1:1)");

    expect(anchored.items[0]).toEqual({
      function: "getUser",
      file: "/app/.env",
      line: 1,
      column: 29,
    });
  });

  it("does not read a hidden file when there is no source map", async () => {
    const root = await createProject({ "dist/plain.js": "function a(){}\n" });

    const anchored = await anchor(root, "a (/ci/dist/plain.js:1:1)", "x (/ci/src/users.ts:1:1)");

    expect(anchored.items[0]).toMatchObject({ file: "/ci/dist/plain.js" });
  });
});
