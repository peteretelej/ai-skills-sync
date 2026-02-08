import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { expandHome, normalizePath, getProjectRoot } from "../src/paths.js";

describe("expandHome", () => {
  it("expands ~ to home directory", () => {
    expect(expandHome("~/projects")).toBe(
      path.join(os.homedir(), "projects")
    );
  });

  it("expands bare ~", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHome("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("leaves relative paths unchanged", () => {
    expect(expandHome("./foo/bar")).toBe("./foo/bar");
  });

  it("does not expand ~ in the middle of a path", () => {
    expect(expandHome("/foo/~/bar")).toBe("/foo/~/bar");
  });
});

describe("normalizePath", () => {
  it("expands tilde and normalizes", () => {
    const result = normalizePath("~/projects/foo");
    expect(result).toBe(path.join(os.homedir(), "projects", "foo"));
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("normalizes . and .. segments", () => {
    const result = normalizePath("/foo/bar/../baz");
    expect(result).toBe("/foo/baz");
  });

  it("makes relative paths absolute", () => {
    const result = normalizePath("foo/bar");
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("handles already-absolute paths", () => {
    expect(normalizePath("/usr/local/bin")).toBe("/usr/local/bin");
  });
});

describe("getProjectRoot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .git directory at cwd", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    expect(getProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it("finds .git in parent directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    const subDir = path.join(tmpDir, "src", "nested");
    fs.mkdirSync(subDir, { recursive: true });
    expect(getProjectRoot(subDir)).toBe(tmpDir);
  });

  it("returns cwd when no .git found", () => {
    const noGitDir = path.join(tmpDir, "no-git");
    fs.mkdirSync(noGitDir, { recursive: true });
    expect(getProjectRoot(noGitDir)).toBe(noGitDir);
  });
});
