import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SyncState } from "../src/types.js";

let tmpDir: string;
let cacheDir: string;

vi.mock("../src/paths.js", () => ({
  getCacheDir: () => cacheDir,
  expandHome: (p: string) => {
    if (p === "~") return os.homedir();
    if (p.startsWith("~/") || p.startsWith("~\\")) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  },
}));

// Mock execa to avoid real git operations
const mockExeca = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

const {
  getCachePath,
  findCachedSkill,
  resolveLocalSkill,
  cloneAndExtract,
  fetchSkill,
  cleanCache,
  registerCleanup,
  pendingCleanups,
  getTempDir,
} = await import("../src/fetcher.js");

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-fetcher-test-"));
  cacheDir = path.join(tmpDir, "cache");
  await fsp.mkdir(cacheDir, { recursive: true });
  mockExeca.mockReset();
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
  pendingCleanups.clear();
});

describe("getCachePath", () => {
  it("builds path for root skill", () => {
    const result = getCachePath(
      { owner: "obra", repo: "tdd" },
      "abc123",
    );
    expect(result).toBe(path.join(cacheDir, "github", "obra", "tdd", "abc123"));
  });

  it("builds path for monorepo subpath", () => {
    const result = getCachePath(
      { owner: "microsoft", repo: "skills" },
      "def456",
      ".github/skills/azure-cosmos-db-py",
    );
    expect(result).toBe(
      path.join(
        cacheDir,
        "github",
        "microsoft",
        "skills",
        "def456",
        ".github/skills/azure-cosmos-db-py",
      ),
    );
  });

  it("includes ref in parsed source without affecting path", () => {
    const result = getCachePath(
      { owner: "obra", repo: "tdd", ref: "v1.2" },
      "abc123",
    );
    expect(result).toBe(path.join(cacheDir, "github", "obra", "tdd", "abc123"));
  });
});

describe("resolveLocalSkill", () => {
  it("resolves an existing local directory", async () => {
    const skillDir = path.join(tmpDir, "my-skill");
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(path.join(skillDir, "SKILL.md"), "# My Skill");

    const result = resolveLocalSkill({ source: "local", path: skillDir });
    expect(result).toBe(skillDir);
  });

  it("throws SkillNotFoundError when path does not exist", () => {
    expect(() =>
      resolveLocalSkill({ source: "local", path: "/nonexistent/skill" }),
    ).toThrow("Skill not found");
  });

  it("throws SkillNotFoundError when no path is provided", () => {
    expect(() => resolveLocalSkill({ source: "local" })).toThrow(
      "local skill requires a path",
    );
  });

  it("throws SkillNotFoundError when path points to a file", async () => {
    const filePath = path.join(tmpDir, "not-a-dir.txt");
    await fsp.writeFile(filePath, "content");

    expect(() =>
      resolveLocalSkill({ source: "local", path: filePath }),
    ).toThrow("is not a directory");
  });
});

describe("findCachedSkill", () => {
  it("returns path when cached version exists", async () => {
    const cachedDir = path.join(cacheDir, "github", "obra", "tdd", "abc123");
    await fsp.mkdir(cachedDir, { recursive: true });
    await fsp.writeFile(path.join(cachedDir, "SKILL.md"), "# TDD");

    const result = findCachedSkill({ source: "obra/tdd" });
    expect(result).toBe(cachedDir);
  });

  it("returns null when no cached version exists", () => {
    const result = findCachedSkill({ source: "obra/tdd" });
    expect(result).toBeNull();
  });

  it("returns subpath within cached version", async () => {
    const cachedDir = path.join(
      cacheDir,
      "github",
      "microsoft",
      "skills",
      "abc123",
      ".github",
      "skills",
      "cosmos",
    );
    await fsp.mkdir(cachedDir, { recursive: true });
    await fsp.writeFile(path.join(cachedDir, "SKILL.md"), "# Cosmos");

    const result = findCachedSkill({
      source: "microsoft/skills",
      path: ".github/skills/cosmos",
    });
    expect(result).toBe(cachedDir);
  });

  it("returns null when repo dir exists but subpath is missing", async () => {
    const cachedDir = path.join(
      cacheDir,
      "github",
      "microsoft",
      "skills",
      "abc123",
    );
    await fsp.mkdir(cachedDir, { recursive: true });

    const result = findCachedSkill({
      source: "microsoft/skills",
      path: ".github/skills/nonexistent",
    });
    expect(result).toBeNull();
  });
});

describe("cloneAndExtract", () => {
  it("clones repo and copies to cache", async () => {
    // Setup: mock git clone to create files in the temp dir
    const ref = { source: "obra/tdd" };
    const tempDir = getTempDir(ref.source);

    mockExeca.mockImplementation(async (cmd: string, args: string[], opts?: Record<string, unknown>) => {
      if (args[0] === "clone") {
        // Simulate git clone by creating files in tempDir
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, "SKILL.md"), "# TDD");
        await fsp.mkdir(path.join(targetDir, ".git"), { recursive: true });
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123def456" };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await cloneAndExtract(ref);

    expect(result.commitSha).toBe("abc123def456");
    expect(fs.existsSync(result.cachePath)).toBe(true);
    expect(fs.existsSync(path.join(result.cachePath, "SKILL.md"))).toBe(true);

    // Temp dir should be cleaned up
    expect(fs.existsSync(tempDir)).toBe(false);
  });

  it("includes --branch when ref is specified", async () => {
    const ref = { source: "obra/tdd@v1.2" };

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "clone") {
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, "SKILL.md"), "# TDD");
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123" };
      }
      return { stdout: "", stderr: "" };
    });

    await cloneAndExtract(ref);

    // Check that the clone call included --branch v1.2
    const cloneCall = mockExeca.mock.calls.find(
      (call: unknown[]) => (call[1] as string[])[0] === "clone",
    );
    expect(cloneCall).toBeDefined();
    const cloneArgs = cloneCall![1] as string[];
    expect(cloneArgs).toContain("--branch");
    expect(cloneArgs).toContain("v1.2");
  });

  it("omits --branch when no ref is specified", async () => {
    const ref = { source: "obra/tdd" };

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "clone") {
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, "SKILL.md"), "# TDD");
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123" };
      }
      return { stdout: "", stderr: "" };
    });

    await cloneAndExtract(ref);

    const cloneCall = mockExeca.mock.calls.find(
      (call: unknown[]) => (call[1] as string[])[0] === "clone",
    );
    const cloneArgs = cloneCall![1] as string[];
    expect(cloneArgs).not.toContain("--branch");
  });

  it("throws SkillNotFoundError when subpath does not exist", async () => {
    const ref = { source: "microsoft/skills", path: "nonexistent/path" };

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "clone") {
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, "SKILL.md"), "# Root");
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123" };
      }
      return { stdout: "", stderr: "" };
    });

    await expect(cloneAndExtract(ref)).rejects.toThrow("Skill not found");
  });

  it("throws FetchError on git clone failure", async () => {
    const ref = { source: "nonexistent/repo" };

    mockExeca.mockImplementation(async () => {
      throw new Error("fatal: repository not found");
    });

    await expect(cloneAndExtract(ref)).rejects.toThrow("Failed to fetch");
  });

  it("passes GIT_TERMINAL_PROMPT=0 and timeout to execa", async () => {
    const ref = { source: "obra/tdd" };

    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "clone") {
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123" };
      }
      return { stdout: "", stderr: "" };
    });

    await cloneAndExtract(ref);

    const cloneCall = mockExeca.mock.calls.find(
      (call: unknown[]) => (call[1] as string[])[0] === "clone",
    );
    const opts = cloneCall![2] as { timeout?: number; env?: Record<string, string> };
    expect(opts.timeout).toBe(60_000);
    expect(opts.env?.GIT_TERMINAL_PROMPT).toBe("0");
  });
});

describe("fetchSkill", () => {
  it("returns cached path when skill is already cached (no clone)", async () => {
    // Pre-populate cache
    const cachedDir = path.join(cacheDir, "github", "obra", "tdd", "abc123");
    await fsp.mkdir(cachedDir, { recursive: true });
    await fsp.writeFile(path.join(cachedDir, "SKILL.md"), "# TDD");

    const result = await fetchSkill({ source: "obra/tdd" });

    expect(result.path).toBe(cachedDir);
    // execa should NOT have been called (cache hit)
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("clones when skill is not cached", async () => {
    mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
      if (args[0] === "clone") {
        const targetDir = args[args.length - 1] as string;
        await fsp.mkdir(targetDir, { recursive: true });
        await fsp.writeFile(path.join(targetDir, "SKILL.md"), "# TDD");
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        return { stdout: "abc123" };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await fetchSkill({ source: "obra/tdd" });

    expect(result.commitSha).toBe("abc123");
    expect(fs.existsSync(result.path)).toBe(true);
    // execa should have been called (cache miss)
    expect(mockExeca).toHaveBeenCalled();
  });

  it("resolves local skills without cloning", async () => {
    const localDir = path.join(tmpDir, "local-skill");
    await fsp.mkdir(localDir, { recursive: true });
    await fsp.writeFile(path.join(localDir, "SKILL.md"), "# Local");

    const result = await fetchSkill({ source: "local", path: localDir });

    expect(result.path).toBe(localDir);
    expect(result.commitSha).toBeUndefined();
    expect(mockExeca).not.toHaveBeenCalled();
  });
});

describe("registerCleanup", () => {
  it("adds temp dir to pending cleanups set", () => {
    const dir = path.join(tmpDir, "temp-cleanup-test");
    registerCleanup(dir);
    expect(pendingCleanups.has(dir)).toBe(true);
  });

  it("tracks multiple temp dirs", () => {
    const dir1 = path.join(tmpDir, "temp1");
    const dir2 = path.join(tmpDir, "temp2");
    registerCleanup(dir1);
    registerCleanup(dir2);
    expect(pendingCleanups.has(dir1)).toBe(true);
    expect(pendingCleanups.has(dir2)).toBe(true);
  });
});

describe("getTempDir", () => {
  it("produces deterministic path for same source", () => {
    const dir1 = getTempDir("obra/tdd");
    const dir2 = getTempDir("obra/tdd");
    expect(dir1).toBe(dir2);
  });

  it("produces different paths for different sources", () => {
    const dir1 = getTempDir("obra/tdd");
    const dir2 = getTempDir("sentry/code-review");
    expect(dir1).not.toBe(dir2);
  });

  it("path starts with os.tmpdir()", () => {
    const dir = getTempDir("obra/tdd");
    expect(dir.startsWith(os.tmpdir())).toBe(true);
  });

  it("path contains ai-skills-sync prefix", () => {
    const dir = getTempDir("obra/tdd");
    expect(path.basename(dir)).toMatch(/^ai-skills-sync-/);
  });
});

describe("cleanCache", () => {
  it("removes unreferenced cache entries", async () => {
    // Create two cached SHAs
    const sha1Dir = path.join(cacheDir, "github", "obra", "tdd", "sha111");
    const sha2Dir = path.join(cacheDir, "github", "obra", "tdd", "sha222");
    await fsp.mkdir(sha1Dir, { recursive: true });
    await fsp.mkdir(sha2Dir, { recursive: true });
    await fsp.writeFile(path.join(sha1Dir, "SKILL.md"), "old");
    await fsp.writeFile(path.join(sha2Dir, "SKILL.md"), "current");

    // State references only sha222
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              commitSha: "sha222",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };

    const result = await cleanCache(state);

    expect(result.removed).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(sha1Dir)).toBe(false);
    expect(fs.existsSync(sha2Dir)).toBe(true);
  });

  it("returns zeros when cache dir does not exist", async () => {
    // Point to a non-existent cache
    cacheDir = path.join(tmpDir, "nonexistent-cache");
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    const result = await cleanCache(state);
    expect(result.removed).toBe(0);
    expect(result.freedBytes).toBe(0);
  });

  it("removes all entries when state has no skills", async () => {
    const sha1Dir = path.join(cacheDir, "github", "obra", "tdd", "sha111");
    await fsp.mkdir(sha1Dir, { recursive: true });
    await fsp.writeFile(path.join(sha1Dir, "SKILL.md"), "content");

    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    const result = await cleanCache(state);

    expect(result.removed).toBe(1);
    expect(fs.existsSync(sha1Dir)).toBe(false);
  });

  it("cleans up empty parent directories", async () => {
    const sha1Dir = path.join(cacheDir, "github", "obra", "tdd", "sha111");
    await fsp.mkdir(sha1Dir, { recursive: true });
    await fsp.writeFile(path.join(sha1Dir, "SKILL.md"), "content");

    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    await cleanCache(state);

    // Empty owner dir should be cleaned up
    const ownerDir = path.join(cacheDir, "github", "obra");
    expect(fs.existsSync(ownerDir)).toBe(false);
  });

  it("keeps referenced entries across multiple projects", async () => {
    const sha1Dir = path.join(cacheDir, "github", "obra", "tdd", "sha111");
    const sha2Dir = path.join(cacheDir, "github", "sentry", "review", "sha222");
    const sha3Dir = path.join(cacheDir, "github", "old", "stale", "sha333");
    await fsp.mkdir(sha1Dir, { recursive: true });
    await fsp.mkdir(sha2Dir, { recursive: true });
    await fsp.mkdir(sha3Dir, { recursive: true });
    await fsp.writeFile(path.join(sha1Dir, "SKILL.md"), "tdd");
    await fsp.writeFile(path.join(sha2Dir, "SKILL.md"), "review");
    await fsp.writeFile(path.join(sha3Dir, "SKILL.md"), "stale");

    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app1": {
          skills: {
            tdd: {
              source: "obra/tdd",
              commitSha: "sha111",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
        "/app2": {
          skills: {
            review: {
              source: "sentry/review",
              commitSha: "sha222",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "project",
            },
          },
        },
      },
    };

    const result = await cleanCache(state);

    expect(result.removed).toBe(1);
    expect(fs.existsSync(sha1Dir)).toBe(true);
    expect(fs.existsSync(sha2Dir)).toBe(true);
    expect(fs.existsSync(sha3Dir)).toBe(false);
  });
});

describe("integration: real git clone", () => {
  it.skipIf(!process.env["INTEGRATION"])(
    "clones a real public repo",
    async () => {
      // Unmock execa for this test
      const { execa: realExeca } = await vi.importActual<typeof import("execa")>("execa");
      mockExeca.mockImplementation(
        (cmd: string, args: string[], opts?: Record<string, unknown>) =>
          realExeca(cmd, args, opts as Parameters<typeof realExeca>[2]),
      );

      const result = await fetchSkill({ source: "anthropics/skill-hello-world" });

      expect(result.path).toBeDefined();
      expect(fs.existsSync(result.path)).toBe(true);
    },
    30_000,
  );
});
