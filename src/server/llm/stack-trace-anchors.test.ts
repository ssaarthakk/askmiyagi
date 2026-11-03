import { describe, expect, it } from "vitest";
import { anchor, createProject } from "../../../test/stack-trace-project.ts";
import { formatStackTrace } from "./stack-trace.ts";

describe("anchorStackTrace", () => {
  it("anchors each frame to the project file and line, whatever machine the trace came from", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "getUser (/home/someone/app/src/users.ts:3:15)",
      "new Account (C:\\work\\app\\src\\users.ts:8:5)",
      "Account.close (http://localhost:5173/src/users.ts?v=abc:11:12)",
      "async handler (/ci/build/src/users.ts:16:10)",
    );

    expect(anchored.items).toEqual([
      { function: "getUser", file: "src/users.ts", line: 3, column: 15 },
      { function: "new Account", file: "src/users.ts", line: 8, column: 5 },
      { function: "Account.close", file: "src/users.ts", line: 11, column: 12 },
      { function: "handler", file: "src/users.ts", line: 16, column: 10 },
    ]);
  });

  it("warns when the named function is not at that line", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "getUser (/app/src/users.ts:11:5)",
      "handler (/app/src/users.ts:99:1)",
    );

    expect(anchored.items[0]).toMatchObject({
      file: "src/users.ts",
      line: 11,
      warning: "getUser is not at src/users.ts:11",
    });
    expect(anchored.items[1]).toMatchObject({
      warning: "handler is not at src/users.ts:99",
    });
    expect(formatStackTrace(anchored)).toContain(
      "at getUser (src/users.ts:11:5) [warning: getUser is not at src/users.ts:11]",
    );
  });

  it("does not warn for a frame with no function name to check", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "/app/src/users.ts:3:1",
      "Object.<anonymous> (/app/src/users.ts:3:1)",
    );

    expect(anchored.items.some((item) => "warning" in item)).toBe(false);
  });

  it("leaves a frame alone when the file is not in the project", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "run (/elsewhere/other.ts:3:1)",
      "go (/elsewhere/more.ts:1:1)",
    );

    expect(anchored.items).toEqual([
      { function: "run", file: "/elsewhere/other.ts", line: 3, column: 1 },
      { function: "go", file: "/elsewhere/more.ts", line: 1, column: 1 },
    ]);
  });

  it("warns when a source-mapped frame's function is not at the original line", async () => {
    const root = await createProject();

    const anchored = await anchor(
      root,
      "handler (/ci/build/dist/index.js:1:29)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items[0]).toMatchObject({
      file: "src/users.ts",
      line: 3,
      warning: "handler is not at src/users.ts:3",
    });
  });

  it("leaves a frame alone when it names a directory", async () => {
    const root = await createProject({ "deploy/run.ts": "run();\n", "lib.js/a.ts": "a();\n" });

    const anchored = await anchor(
      root,
      "run (/app/scripts/deploy:3:1)",
      "a (/app/lib.js:1:1)",
      "x (/ci/src/users.ts:1:1)",
    );

    expect(anchored.items.slice(0, 2)).toEqual([
      { function: "run", file: "/app/scripts/deploy", line: 3, column: 1 },
      { function: "a", file: "/app/lib.js", line: 1, column: 1 },
    ]);
    expect(anchored.items[2]).toMatchObject({ file: "src/users.ts" });
  });
});
