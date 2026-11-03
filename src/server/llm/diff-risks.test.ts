import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../../test/temp-dir.ts";
import { findCoveringTests, findRisks } from "./diff-risks.ts";

function fileDiff(path: string, ...lines: string[]) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,9 +1,9 @@",
    ...lines,
  ].join("\n");
}

function deletedFileDiff(path: string, ...lines: string[]) {
  return [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    `@@ -1,${lines.length} +0,0 @@`,
    ...lines.map((line) => `-${line}`),
  ].join("\n");
}

describe("findRisks", () => {
  it("flags a removed throw", () => {
    const diff = fileDiff("src/pay.ts", " function pay() {", "-  throw new Error('declined')");

    expect(findRisks(diff)).toEqual(["src/pay.ts: removed a throw: throw new Error('declined')"]);
  });

  it("flags a removed one-line guard", () => {
    const diff = fileDiff("src/pay.ts", "-  if (!user) return null", "+  charge(user)");

    expect(findRisks(diff)).toEqual(["src/pay.ts: removed a guard: if (!user) return null"]);
  });

  it("flags a removed guard whose early exit is on the next line", () => {
    const diff = fileDiff("src/pay.ts", "-  if (!user) {", "-    return null", "-  }");

    expect(findRisks(diff)).toEqual(["src/pay.ts: removed a guard: if (!user) {"]);
  });

  it("flags a removed raise and a removed else-if guard", () => {
    const diff = fileDiff("pay.py", "-    raise ValueError('bad')", "-    elif not user: return");

    expect(findRisks(diff)).toEqual([
      "pay.py: removed a throw: raise ValueError('bad')",
      "pay.py: removed a guard: elif not user: return",
    ]);
  });

  it("flags try and catch lines that were added or removed", () => {
    const diff = fileDiff(
      "src/pay.ts",
      "-  try {",
      "+  await save()",
      "+  } catch (error) {",
      "+  } finally {",
    );

    expect(findRisks(diff)).toEqual([
      "src/pay.ts: removed error handling: try {",
      "src/pay.ts: added error handling: } catch (error) {",
      "src/pay.ts: added error handling: } finally {",
    ]);
  });

  it("flags a removed test, and every test in a deleted file", () => {
    const edited = fileDiff(
      "src/pay.test.ts",
      "-  it('refuses a stolen card', () => {",
      "+  // todo",
    );
    const deleted = deletedFileDiff(
      "src/old.test.ts",
      "describe('old', () => {",
      "  test('x', () => {",
    );

    expect(findRisks(edited)).toEqual([
      "src/pay.test.ts: removed a test: it('refuses a stolen card', () => {",
    ]);
    expect(findRisks(deleted)).toEqual([
      "src/old.test.ts: removed a test: describe('old', () => {",
      "src/old.test.ts: removed a test: test('x', () => {",
    ]);
  });

  it("flags a removed Python and Go test", () => {
    const python = fileDiff("test_pay.py", "-def test_refuses():");
    const go = fileDiff("pay_test.go", "-func TestRefuses(t *testing.T) {");

    expect(findRisks(python)).toHaveLength(1);
    expect(findRisks(go)).toHaveLength(1);
  });

  it("flags nothing for added guards, throws and tests", () => {
    const diff = fileDiff(
      "src/pay.ts",
      "+  if (!user) return null",
      "+  throw new Error('declined')",
      "+  it('works', () => {})",
    );

    expect(findRisks(diff)).toEqual([]);
  });

  it("ignores a line that was only re-indented or moved", () => {
    const diff = fileDiff(
      "src/pay.ts",
      "-  if (!user) return null",
      "-  throw new Error('x')",
      "-  try {",
      "+    if (!user) return null",
      "+    throw new Error('x')",
      "+    try {",
    );

    expect(findRisks(diff)).toEqual([]);
  });

  it("ignores a removed comment that mentions a throw", () => {
    const diff = fileDiff("src/pay.ts", "-  // throws when the card is declined", "-# raise later");

    expect(findRisks(diff)).toEqual([]);
  });

  it("flags nothing for an ordinary edit", () => {
    const diff = fileDiff("src/pay.ts", "-const fee = 1", "+const fee = 2");

    expect(findRisks(diff)).toEqual([]);
  });

  it("keeps each flag with its own file", () => {
    const diff = [
      fileDiff("src/a.ts", "-  throw new Error('a')"),
      fileDiff("src/b.ts", "+  throw new Error('a')"),
    ].join("\n");

    expect(findRisks(diff)).toEqual(["src/a.ts: removed a throw: throw new Error('a')"]);
  });
});

async function projectWith(files: Record<string, string>) {
  const root = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("findCoveringTests", () => {
  it("lists a changed test with the changed source files it imports", async () => {
    const root = await projectWith({
      "src/pay.ts": "export const pay = 1\n",
      "src/tax.ts": "export const tax = 1\n",
      "src/pay.test.ts": 'import { pay } from "./pay.ts"\n',
    });
    const diff = [
      fileDiff("src/pay.ts", "-a", "+b"),
      fileDiff("src/tax.ts", "-a", "+b"),
      fileDiff("src/pay.test.ts", "-a", "+b"),
    ].join("\n");

    await expect(findCoveringTests(root, diff)).resolves.toEqual([
      "src/pay.test.ts covers src/pay.ts",
    ]);
  });

  it("follows an import without an extension and one from another folder", async () => {
    const root = await projectWith({
      "src/pay.ts": "export const pay = 1\n",
      "test/pay.test.ts": 'import { pay } from "../src/pay"\n',
    });
    const diff = [
      fileDiff("src/pay.ts", "-a", "+b"),
      fileDiff("test/pay.test.ts", "-a", "+b"),
    ].join("\n");

    await expect(findCoveringTests(root, diff)).resolves.toEqual([
      "test/pay.test.ts covers src/pay.ts",
    ]);
  });

  it("lists nothing for a changed test that imports no changed source", async () => {
    const root = await projectWith({
      "src/pay.ts": "export const pay = 1\n",
      "src/other.ts": "export const other = 1\n",
      "src/other.test.ts": 'import { other } from "./other.ts"\n',
    });
    const diff = [
      fileDiff("src/pay.ts", "-a", "+b"),
      fileDiff("src/other.test.ts", "-a", "+b"),
    ].join("\n");

    await expect(findCoveringTests(root, diff)).resolves.toEqual([]);
  });
});
