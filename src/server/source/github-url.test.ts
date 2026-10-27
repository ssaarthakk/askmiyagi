import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "./github-url.ts";

describe("parseGitHubUrl", () => {
  it.each([
    "https://github.com/octo/repo",
    "https://github.com/octo/repo.git",
    "https://github.com/octo/repo/",
    "https://github.com/octo/repo.git/",
  ])("accepts %s", (input) => {
    expect(parseGitHubUrl(input)).toEqual({
      ok: true,
      value: "https://github.com/octo/repo.git",
    });
  });

  it("keeps dots, dashes and underscores in names", () => {
    expect(parseGitHubUrl("https://github.com/my-org/my_repo.js")).toEqual({
      ok: true,
      value: "https://github.com/my-org/my_repo.js.git",
    });
  });

  it.each([
    "http://github.com/octo/repo",
    "https://gitlab.com/octo/repo",
    "https://github.com.evil.test/octo/repo",
    "https://www.github.com/octo/repo",
    "https://user:token@github.com/octo/repo",
    "https://github.com:8443/octo/repo",
    "ssh://git@github.com/octo/repo",
    "file:///tmp/repo",
    "https://github.com/octo",
    "https://github.com/octo/repo/tree/main",
    "https://github.com/octo/repo?tab=readme",
    "https://github.com/octo/repo#readme",
    "https://github.com/octo/..",
    "https://github.com/octo/--upload-pack=x",
    "https://github.com/octo/re po",
    "https://github.com//repo",
    "https://github.com/",
    "https:/github.com/octo/repo",
    "not a url",
  ])("refuses %s", (input) => {
    const result = parseGitHubUrl(input);
    expect(result).toEqual({
      ok: false,
      error: `Only https://github.com/<owner>/<repo> URLs can be cloned: ${input}`,
    });
  });
});
