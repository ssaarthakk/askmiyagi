import { join, parse } from "node:path";
import { describe, expect, it } from "vitest";
import { projectName } from "./project-name.ts";

describe("projectName", () => {
  it("is the folder name for a local folder", () => {
    expect(projectName("../clipper", join("C:", "work", "clipper"))).toBe("clipper");
  });

  it("is the root itself for a drive or file-system root", () => {
    const root = parse(process.cwd()).root;
    expect(projectName(root, root)).toBe(root);
  });

  it("is the repository name for a GitHub URL, not the temp clone folder", () => {
    expect(projectName("https://github.com/acme/clipper.git", join("tmp", "repo"))).toBe("clipper");
    expect(projectName("https://github.com/acme/clipper/", join("tmp", "repo"))).toBe("clipper");
  });
});
