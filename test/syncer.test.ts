import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  SyncState,
  ResolvedSkill,
  AgentDir,
  InstalledSkill,
} from "../src/types.js";

let tmpDir: string;

// Mock fetcher
const mockFetchSkill = vi.fn();
vi.mock("../src/fetcher.js", () => ({
  fetchSkill: (...args: unknown[]) => mockFetchSkill(...args),
}));

// Mock logger to suppress output
vi.mock("../src/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  dim: vi.fn(),
  header: vi.fn(),
}));

const {
  syncSkills,
  copySkillToDir,
  rewriteSkillName,
  removeSkillDir,
  checkGitignore,
} = await import("../src/syncer.js");

const logger = await import("../src/logger.js");

function emptyState(): SyncState {
  return { version: 1, lastSync: "", projects: {} };
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-syncer-test-"));
  mockFetchSkill.mockReset();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.dim).mockClear();
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// Helper: create a skill source directory with SKILL.md
async function createSkillSource(
  name: string,
  content?: string,
): Promise<string> {
  const dir = path.join(tmpDir, "sources", name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "SKILL.md"),
    content ??
      `---\nname: ${name}\ndescription: Test skill\n---\n# ${name}\n`,
  );
  return dir;
}

// Helper: set up agent dirs
async function createAgentDirs(
  projectRoot: string,
  types: Array<"opencode" | "claude" | "copilot" | "cursor" | "agents"> = ["claude"],
): Promise<AgentDir[]> {
  const dirs: AgentDir[] = [];
  const relPaths: Record<string, string> = {
    claude: ".claude/skills",
    copilot: ".github/skills",
    cursor: ".cursor/skills",
  };
  for (const type of types) {
    const skillsPath = path.join(projectRoot, relPaths[type]);
    await fsp.mkdir(skillsPath, { recursive: true });
    dirs.push({ type, skillsPath });
  }
  return dirs;
}

describe("copySkillToDir", () => {
  it("copies skill directory recursively", async () => {
    const src = await createSkillSource("tdd");
    const dest = path.join(tmpDir, "dest", "tdd");

    await copySkillToDir(src, dest);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    const content = await fsp.readFile(path.join(dest, "SKILL.md"), "utf-8");
    expect(content).toContain("name: tdd");
  });

  it("overwrites existing destination", async () => {
    const src = await createSkillSource("tdd");
    const dest = path.join(tmpDir, "dest", "tdd");

    // Create existing destination with different content
    await fsp.mkdir(dest, { recursive: true });
    await fsp.writeFile(path.join(dest, "old-file.txt"), "old");

    await copySkillToDir(src, dest);

    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "old-file.txt"))).toBe(false);
  });
});

describe("rewriteSkillName", () => {
  it("rewrites name field in SKILL.md frontmatter", async () => {
    const skillDir = path.join(tmpDir, "skill");
    await fsp.mkdir(skillDir, { recursive: true });
    const mdPath = path.join(skillDir, "SKILL.md");
    await fsp.writeFile(
      mdPath,
      "---\nname: tdd\ndescription: Test\n---\n# TDD Skill\n",
    );

    await rewriteSkillName(mdPath, "obra.tdd");

    const content = await fsp.readFile(mdPath, "utf-8");
    expect(content).toContain("name: obra.tdd");
    expect(content).toContain("description: Test");
    expect(content).toContain("# TDD Skill");
  });

  it("does nothing if no frontmatter", async () => {
    const skillDir = path.join(tmpDir, "skill");
    await fsp.mkdir(skillDir, { recursive: true });
    const mdPath = path.join(skillDir, "SKILL.md");
    const original = "# TDD Skill\nNo frontmatter here.\n";
    await fsp.writeFile(mdPath, original);

    await rewriteSkillName(mdPath, "obra.tdd");

    const content = await fsp.readFile(mdPath, "utf-8");
    expect(content).toBe(original);
  });

  it("does nothing if no name field in frontmatter", async () => {
    const skillDir = path.join(tmpDir, "skill");
    await fsp.mkdir(skillDir, { recursive: true });
    const mdPath = path.join(skillDir, "SKILL.md");
    const original = "---\ndescription: Test\n---\n# Content\n";
    await fsp.writeFile(mdPath, original);

    await rewriteSkillName(mdPath, "obra.tdd");

    const content = await fsp.readFile(mdPath, "utf-8");
    expect(content).toBe(original);
  });

  it("preserves content after frontmatter", async () => {
    const skillDir = path.join(tmpDir, "skill");
    await fsp.mkdir(skillDir, { recursive: true });
    const mdPath = path.join(skillDir, "SKILL.md");
    await fsp.writeFile(
      mdPath,
      "---\nname: tdd\n---\n# TDD\n\nSome content with name: tdd in body.\n",
    );

    await rewriteSkillName(mdPath, "obra.tdd");

    const content = await fsp.readFile(mdPath, "utf-8");
    expect(content).toContain("name: obra.tdd");
    // Body content should be unchanged
    expect(content).toContain("name: tdd in body");
  });
});

describe("removeSkillDir", () => {
  it("removes a directory recursively", async () => {
    const dir = path.join(tmpDir, "to-remove");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "file.txt"), "content");

    await removeSkillDir(dir);

    expect(fs.existsSync(dir)).toBe(false);
  });

  it("does not throw if directory does not exist", async () => {
    await expect(
      removeSkillDir(path.join(tmpDir, "nonexistent")),
    ).resolves.not.toThrow();
  });
});

describe("checkGitignore", () => {
  it("returns uncovered paths when .gitignore missing", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });

    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "copilot",
    ]);
    const result = await checkGitignore(projectRoot, agentDirs);

    expect(result).toContain(".claude/skills");
    expect(result).toContain(".github/skills");
  });

  it("detects covered paths", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      ".claude/skills\n.github/skills\n",
    );

    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "copilot",
    ]);
    const result = await checkGitignore(projectRoot, agentDirs);

    expect(result).toHaveLength(0);
  });

  it("detects parent directory coverage", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      ".claude/\n",
    );

    const agentDirs = await createAgentDirs(projectRoot, ["claude"]);
    const result = await checkGitignore(projectRoot, agentDirs);

    // .claude/ covers .claude/skills
    expect(result).toHaveLength(0);
  });

  it("returns only uncovered paths", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      ".claude/skills\n",
    );

    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "copilot",
    ]);
    const result = await checkGitignore(projectRoot, agentDirs);

    expect(result).toEqual([".github/skills"]);
  });

  it("ignores comments in .gitignore", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      "# Agent skills\n# .claude/skills\n",
    );

    const agentDirs = await createAgentDirs(projectRoot, ["claude"]);
    const result = await checkGitignore(projectRoot, agentDirs);

    expect(result).toContain(".claude/skills");
  });

  it("handles trailing slashes in .gitignore entries", async () => {
    const projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      ".claude/skills/\n",
    );

    const agentDirs = await createAgentDirs(projectRoot, ["claude"]);
    const result = await checkGitignore(projectRoot, agentDirs);

    expect(result).toHaveLength(0);
  });
});

describe("syncSkills", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = path.join(tmpDir, "project");
    await fsp.mkdir(projectRoot, { recursive: true });
    // Create .gitignore covering agent dirs to avoid gitignore suggestions in most tests
    await fsp.writeFile(
      path.join(projectRoot, ".gitignore"),
      ".claude/skills\n.github/skills\n.cursor/skills\n",
    );
  });

  it("returns early with alreadyInSync when state matches", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    const state: SyncState = {
      version: 1,
      lastSync: "2026-02-01T00:00:00Z",
      projects: {
        [projectRoot]: {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-01T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state,
      dryRun: false,
    });

    expect(result.alreadyInSync).toBe(true);
    expect(result.synced).toHaveLength(0);
    expect(mockFetchSkill).not.toHaveBeenCalled();
  });

  it("copies skills to multiple agent directories", async () => {
    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "copilot",
    ]);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc123",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toEqual(["tdd"]);
    expect(result.errors).toHaveLength(0);

    // Verify files in both agent dirs
    for (const dir of agentDirs) {
      const skillMd = path.join(dir.skillsPath, "tdd", "SKILL.md");
      expect(fs.existsSync(skillMd)).toBe(true);
    }
  });

  it("rewrites SKILL.md name on namespace collision", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc123",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "obra.tdd", // collision name
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toEqual(["obra.tdd"]);

    const skillMd = path.join(
      agentDirs[0].skillsPath,
      "obra.tdd",
      "SKILL.md",
    );
    const content = await fsp.readFile(skillMd, "utf-8");
    expect(content).toContain("name: obra.tdd");
  });

  it("detects and removes orphaned conditional skills", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    // Create orphan directory on disk
    const orphanDir = path.join(agentDirs[0].skillsPath, "terraform-patterns");
    await fsp.mkdir(orphanDir, { recursive: true });
    await fsp.writeFile(path.join(orphanDir, "SKILL.md"), "# Terraform");

    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        [projectRoot]: {
          skills: {
            "terraform-patterns": {
              source: "hashicorp/terraform-patterns",
              syncedAt: "2026-02-01T00:00:00Z",
              agents: ["claude"],
              type: "conditional", // conditional = auto-remove
            },
          },
        },
      },
    };

    // No resolved skills (the conditional no longer matches)
    const result = await syncSkills({
      projectRoot,
      resolvedSkills: [],
      agentDirs,
      state,
      dryRun: false,
    });

    expect(result.removed).toEqual(["terraform-patterns"]);
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  it("suggests removal for orphaned explicit skills without deleting", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    // Create orphan directory on disk
    const orphanDir = path.join(agentDirs[0].skillsPath, "old-skill");
    await fsp.mkdir(orphanDir, { recursive: true });
    await fsp.writeFile(path.join(orphanDir, "SKILL.md"), "# Old");

    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        [projectRoot]: {
          skills: {
            "old-skill": {
              source: "old/skill",
              syncedAt: "2026-02-01T00:00:00Z",
              agents: ["claude"],
              type: "global", // explicit = suggest only
            },
          },
        },
      },
    };

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: [],
      agentDirs,
      state,
      dryRun: false,
    });

    expect(result.orphaned).toEqual(["old-skill"]);
    // Should NOT be removed from disk
    expect(fs.existsSync(orphanDir)).toBe(true);
    // Should still be in updated state
    expect(result.updatedState.projects[projectRoot].skills["old-skill"]).toBeDefined();
  });

  it("skips copy when directory exists and is not managed", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    // Create a manually placed skill
    const manualDir = path.join(agentDirs[0].skillsPath, "manual-skill");
    await fsp.mkdir(manualDir, { recursive: true });
    await fsp.writeFile(path.join(manualDir, "SKILL.md"), "# Manual");

    const manualSource = await createSkillSource("manual-skill");
    mockFetchSkill.mockResolvedValue({
      path: manualSource,
      commitSha: "abc123",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "someone/manual-skill" },
        type: "global",
        installName: "manual-skill",
      },
    ];

    // State does NOT track this skill (it was manually placed)
    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    // Skill should not be synced (skipped)
    expect(result.synced).toHaveLength(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();

    // Original manual content should be preserved
    const content = await fsp.readFile(
      path.join(manualDir, "SKILL.md"),
      "utf-8",
    );
    expect(content).toBe("# Manual");
  });

  it("dry-run produces no filesystem side effects", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc123",
    });

    // Also set up a conditional orphan to verify it's not removed
    const orphanDir = path.join(agentDirs[0].skillsPath, "terraform-patterns");
    await fsp.mkdir(orphanDir, { recursive: true });
    await fsp.writeFile(path.join(orphanDir, "SKILL.md"), "# TF");

    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        [projectRoot]: {
          skills: {
            "terraform-patterns": {
              source: "hashicorp/terraform-patterns",
              syncedAt: "2026-02-01T00:00:00Z",
              agents: ["claude"],
              type: "conditional",
            },
          },
        },
      },
    };

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state,
      dryRun: true,
    });

    // Results report what would happen
    expect(result.synced).toEqual(["tdd"]);
    expect(result.removed).toEqual(["terraform-patterns"]);

    // But no files were actually written
    expect(
      fs.existsSync(path.join(agentDirs[0].skillsPath, "tdd")),
    ).toBe(false);

    // Orphan was NOT removed
    expect(fs.existsSync(orphanDir)).toBe(true);

    // State is unchanged
    expect(result.updatedState).toBe(state);
  });

  it("handles partial failure: one skill fails, others still sync", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill
      .mockResolvedValueOnce({ path: tddSource, commitSha: "abc123" })
      .mockRejectedValueOnce(new Error("Network timeout"));

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
      {
        ref: { source: "failing/skill" },
        type: "project",
        installName: "failing-skill",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toEqual(["tdd"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("failing-skill");

    // tdd was still copied successfully
    expect(
      fs.existsSync(path.join(agentDirs[0].skillsPath, "tdd", "SKILL.md")),
    ).toBe(true);
  });

  it("updates state correctly after sync", async () => {
    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "copilot",
    ]);
    const tddSource = await createSkillSource("tdd");
    const debugSource = await createSkillSource("debug");

    mockFetchSkill
      .mockResolvedValueOnce({ path: tddSource, commitSha: "sha1" })
      .mockResolvedValueOnce({ path: debugSource, commitSha: "sha2" });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
      {
        ref: { source: "obra/debug" },
        type: "project",
        installName: "debug",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    const ps = result.updatedState.projects[projectRoot];
    expect(ps).toBeDefined();
    expect(Object.keys(ps.skills)).toHaveLength(2);

    expect(ps.skills["tdd"].source).toBe("obra/tdd");
    expect(ps.skills["tdd"].commitSha).toBe("sha1");
    expect(ps.skills["tdd"].type).toBe("global");
    expect(ps.skills["tdd"].agents).toEqual(["claude", "copilot"]);

    expect(ps.skills["debug"].source).toBe("obra/debug");
    expect(ps.skills["debug"].commitSha).toBe("sha2");
    expect(ps.skills["debug"].type).toBe("project");
    expect(ps.skills["debug"].agents).toEqual(["claude", "copilot"]);

    expect(result.updatedState.lastSync).toBeTruthy();
  });

  it("exit code: synced.length > 0 means success", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    // CLI exit 0: at least one skill synced
    expect(result.synced.length > 0 || result.errors.length === 0).toBe(true);
  });

  it("exit code: all skills failed means failure", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    mockFetchSkill.mockRejectedValue(new Error("Network down"));

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
      {
        ref: { source: "obra/debug" },
        type: "project",
        installName: "debug",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    // CLI exit 1: no skills synced, all failed
    expect(result.synced).toHaveLength(0);
    expect(result.errors.length).toBe(resolved.length);
  });

  it("exit code: empty resolved skills means nothing to sync (success)", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: [],
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    // CLI exit 0: nothing to sync, already in sync
    expect(result.alreadyInSync).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it(".gitignore suggestion appears when paths are uncovered", async () => {
    const projectRoot2 = path.join(tmpDir, "project-no-gitignore");
    await fsp.mkdir(projectRoot2, { recursive: true });
    // No .gitignore in this project

    const agentDirs = await createAgentDirs(projectRoot2);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    const result = await syncSkills({
      projectRoot: projectRoot2,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.gitignoreSuggestions.length).toBeGreaterThan(0);
    expect(result.gitignoreSuggestions).toContain(".claude/skills");
  });

  it(".gitignore suggestion is NOT repeated on subsequent syncs", async () => {
    const projectRoot2 = path.join(tmpDir, "project-gitignore-track");
    await fsp.mkdir(projectRoot2, { recursive: true });
    // No .gitignore -> will trigger suggestion

    const agentDirs = await createAgentDirs(projectRoot2);
    const tddSource = await createSkillSource("tdd");
    const debugSource = await createSkillSource("debug");

    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
    ];

    // First sync: should get suggestions
    const first = await syncSkills({
      projectRoot: projectRoot2,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(first.gitignoreSuggestions.length).toBeGreaterThan(0);
    expect(
      first.updatedState.projects[projectRoot2].gitignoreSuggested,
    ).toBe(true);

    // Second sync with updated state: should NOT get suggestions
    mockFetchSkill.mockResolvedValue({
      path: debugSource,
      commitSha: "def",
    });

    const resolved2: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
      {
        ref: { source: "obra/debug" },
        type: "global",
        installName: "debug",
      },
    ];

    const second = await syncSkills({
      projectRoot: projectRoot2,
      resolvedSkills: resolved2,
      agentDirs,
      state: first.updatedState,
      dryRun: false,
    });

    expect(second.gitignoreSuggestions).toHaveLength(0);
  });

  it("preserves failed skills in state if previously synced", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const tddSource = await createSkillSource("tdd");

    mockFetchSkill
      .mockResolvedValueOnce({ path: tddSource, commitSha: "new-sha" })
      .mockRejectedValueOnce(new Error("Network error"));

    const existingSkill: InstalledSkill = {
      source: "obra/debug",
      commitSha: "old-sha",
      syncedAt: "2026-02-01T00:00:00Z",
      agents: ["claude"],
      type: "project",
    };

    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        [projectRoot]: {
          skills: {
            debug: existingSkill,
          },
        },
      },
    };

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/tdd" },
        type: "global",
        installName: "tdd",
      },
      {
        ref: { source: "obra/debug" },
        type: "project",
        installName: "debug",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state,
      dryRun: false,
    });

    expect(result.synced).toEqual(["tdd"]);
    expect(result.errors).toHaveLength(1);

    // Failed skill should keep old state entry
    const ps = result.updatedState.projects[projectRoot];
    expect(ps.skills["debug"]).toBeDefined();
    expect(ps.skills["debug"].commitSha).toBe("old-sha");
  });

  it("handles multiple skills with nested directories", async () => {
    const agentDirs = await createAgentDirs(projectRoot);

    // Create a skill with nested structure
    const nestedDir = path.join(tmpDir, "sources", "nested");
    await fsp.mkdir(path.join(nestedDir, "lib"), { recursive: true });
    await fsp.writeFile(
      path.join(nestedDir, "SKILL.md"),
      "---\nname: nested\n---\n# Nested\n",
    );
    await fsp.writeFile(
      path.join(nestedDir, "lib", "helper.md"),
      "# Helper\n",
    );

    mockFetchSkill.mockResolvedValue({
      path: nestedDir,
      commitSha: "abc",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: { source: "obra/nested" },
        type: "global",
        installName: "nested",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toEqual(["nested"]);

    // Verify nested structure was copied
    const copiedHelper = path.join(
      agentDirs[0].skillsPath,
      "nested",
      "lib",
      "helper.md",
    );
    expect(fs.existsSync(copiedHelper)).toBe(true);
  });

  it("stores skill path in state for monorepo skills", async () => {
    const agentDirs = await createAgentDirs(projectRoot);
    const cosmosSource = await createSkillSource("azure-cosmos-db-py");

    mockFetchSkill.mockResolvedValue({
      path: cosmosSource,
      commitSha: "abc",
    });

    const resolved: ResolvedSkill[] = [
      {
        ref: {
          source: "microsoft/skills",
          path: ".github/skills/azure-cosmos-db-py",
        },
        type: "project",
        installName: "azure-cosmos-db-py",
      },
    ];

    const result = await syncSkills({
      projectRoot,
      resolvedSkills: resolved,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    const ps = result.updatedState.projects[projectRoot];
    expect(ps.skills["azure-cosmos-db-py"].path).toBe(
      ".github/skills/azure-cosmos-db-py",
    );
  });
});
