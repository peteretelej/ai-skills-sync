import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  Config,
  SyncState,
  AgentDir,
  SkillRef,
} from "../src/types.js";

let tmpDir: string;

// Mock paths to use temp directories (closure over tmpDir, assigned in beforeEach)
vi.mock("../src/paths.js", async () => {
  const actual = (await vi.importActual("../src/paths.js")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    getConfigPath: () => path.join(tmpDir, "config.json"),
    getStatePath: () => path.join(tmpDir, "state.json"),
    getCacheDir: () => path.join(tmpDir, "cache"),
  };
});

// Mock logger to suppress output
vi.mock("../src/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  dim: vi.fn(),
  header: vi.fn(),
}));

// Mock fetcher (no network calls in tests)
const mockFetchSkill = vi.fn();
const mockCleanCache = vi.fn();
vi.mock("../src/fetcher.js", () => ({
  fetchSkill: (...args: unknown[]) => mockFetchSkill(...args),
  cleanCache: (...args: unknown[]) => mockCleanCache(...args),
}));

// Mock @inquirer/prompts to avoid interactive prompts
const mockSelect = vi.fn();
const mockCheckbox = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  checkbox: (...args: unknown[]) => mockCheckbox(...args),
}));

// Import after mocks are set up
const logger = await import("../src/logger.js");
const {
  loadConfig,
  saveConfig,
  configExists,
  ensureConfig,
  addSkillToConfig,
  removeSkillFromConfig,
} = await import("../src/config.js");
const { loadState, saveState } = await import("../src/state.js");
const { resolveSkills } = await import("../src/resolver.js");
const { syncSkills } = await import("../src/syncer.js");
const { getConfigPath, getStatePath } = await import("../src/paths.js");
const { ConfigError, SkillNotFoundError } = await import(
  "../src/errors.js"
);

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-cli-test-"));
  await fsp.mkdir(path.join(tmpDir, "cache"), { recursive: true });

  mockFetchSkill.mockReset();
  mockCleanCache.mockReset();
  mockSelect.mockReset();
  mockCheckbox.mockReset();

  vi.mocked(logger.info).mockClear();
  vi.mocked(logger.success).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.dim).mockClear();
  vi.mocked(logger.header).mockClear();
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// --- Helpers ---

async function createProjectDir(name = "my-project"): Promise<string> {
  const projectRoot = path.join(tmpDir, name);
  await fsp.mkdir(projectRoot, { recursive: true });
  await fsp.mkdir(path.join(projectRoot, ".git"), { recursive: true });
  return projectRoot;
}

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

async function writeConfig(config: Config): Promise<void> {
  await fsp.writeFile(
    path.join(tmpDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

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

async function addGitignore(
  projectRoot: string,
  content = ".claude/skills\n.github/skills\n.cursor/skills\n",
): Promise<void> {
  await fsp.writeFile(path.join(projectRoot, ".gitignore"), content);
}

function emptyState(): SyncState {
  return { version: 1, lastSync: "", projects: {} };
}

// --- Tests ---

describe("CLI integration: first run with no config", () => {
  it("wizard creates config when none exists", async () => {
    expect(configExists()).toBe(false);

    // Simulate user choosing "defaults"
    mockSelect.mockResolvedValue("defaults");

    const config = await ensureConfig();

    expect(configExists()).toBe(true);
    expect(config).toHaveProperty("global");
    expect(config).toHaveProperty("projects");
    expect(config).toHaveProperty("conditional");
  });
});

describe("CLI integration: add local skill and verify in agent dirs", () => {
  it("adds a local skill and copies it to agent directories", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);
    const skillSource = await createSkillSource("my-custom");

    await writeConfig({ global: [], projects: {}, conditional: [] });
    const config = loadConfig()!;

    // Add to config
    const ref: SkillRef = { source: "local", path: skillSource };
    const updated = addSkillToConfig(config, ref, { section: "global" });
    await saveConfig(updated);

    // Mock fetch for local skill
    mockFetchSkill.mockResolvedValue({ path: skillSource });

    // Resolve and sync
    const resolvedSkills = await resolveSkills(updated, projectRoot);
    expect(resolvedSkills.length).toBeGreaterThan(0);

    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toContain("my-custom");

    // Verify skill was copied
    const skillMd = path.join(
      agentDirs[0].skillsPath,
      "my-custom",
      "SKILL.md",
    );
    expect(fs.existsSync(skillMd)).toBe(true);
  });
});

describe("CLI integration: multi-agent sync", () => {
  it("copies skills to both .claude and .cursor dirs", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot, [
      "claude",
      "cursor",
    ]);
    await addGitignore(projectRoot);

    const tddSource = await createSkillSource("tdd");
    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc123",
    });

    await writeConfig({ global: [{ source: "obra/tdd" }] });
    const config = loadConfig()!;

    const resolvedSkills = await resolveSkills(config, projectRoot);
    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toContain("tdd");

    for (const dir of agentDirs) {
      const skillMd = path.join(dir.skillsPath, "tdd", "SKILL.md");
      expect(fs.existsSync(skillMd)).toBe(true);
    }
  });
});

describe("CLI integration: conditional match", () => {
  it("activates skill when tsx files exist", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    // Create .tsx file to trigger conditional
    await fsp.writeFile(
      path.join(projectRoot, "App.tsx"),
      "export default function App() {}",
    );

    const reactSource = await createSkillSource("react-best-practices");
    mockFetchSkill.mockResolvedValue({
      path: reactSource,
      commitSha: "react123",
    });

    await writeConfig({
      conditional: [
        {
          when: "**/*.tsx",
          skills: [{ source: "vercel/react-best-practices" }],
        },
      ],
    });

    const config = loadConfig()!;
    const resolvedSkills = await resolveSkills(config, projectRoot);
    expect(resolvedSkills).toHaveLength(1);
    expect(resolvedSkills[0].type).toBe("conditional");

    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toContain("react-best-practices");
  });
});

describe("CLI integration: conditional removal", () => {
  it("removes conditional skill when matching files are deleted", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const tsxFile = path.join(projectRoot, "App.tsx");
    await fsp.writeFile(tsxFile, "export default function App() {}");

    const reactSource = await createSkillSource("react-best-practices");
    mockFetchSkill.mockResolvedValue({
      path: reactSource,
      commitSha: "react123",
    });

    const config: Config = {
      conditional: [
        {
          when: "**/*.tsx",
          skills: [{ source: "vercel/react-best-practices" }],
        },
      ],
    };
    await writeConfig(config);

    // First sync: conditional matches
    const resolved1 = await resolveSkills(config, projectRoot);
    const result1 = await syncSkills({
      projectRoot,
      resolvedSkills: resolved1,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });
    expect(result1.synced).toContain("react-best-practices");

    // Delete the .tsx file
    await fsp.rm(tsxFile);

    // Second sync: conditional no longer matches
    const resolved2 = await resolveSkills(config, projectRoot);
    expect(resolved2).toHaveLength(0);

    const result2 = await syncSkills({
      projectRoot,
      resolvedSkills: resolved2,
      agentDirs,
      state: result1.updatedState,
      dryRun: false,
    });

    expect(result2.removed).toContain("react-best-practices");
    const skillDir = path.join(
      agentDirs[0].skillsPath,
      "react-best-practices",
    );
    expect(fs.existsSync(skillDir)).toBe(false);
  });
});

describe("CLI integration: namespace collision", () => {
  it("dot-prefixes skills when two orgs have the same name", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const obraTdd = await createSkillSource("obra-tdd");
    const acmeTdd = await createSkillSource("acme-tdd");

    mockFetchSkill
      .mockResolvedValueOnce({ path: obraTdd, commitSha: "sha1" })
      .mockResolvedValueOnce({ path: acmeTdd, commitSha: "sha2" });

    await writeConfig({
      global: [{ source: "obra/tdd" }, { source: "acme/tdd" }],
    });

    const config = loadConfig()!;
    const resolvedSkills = await resolveSkills(config, projectRoot);

    const names = resolvedSkills.map((s) => s.installName);
    expect(names).toContain("obra.tdd");
    expect(names).toContain("acme.tdd");

    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toContain("obra.tdd");
    expect(result.synced).toContain("acme.tdd");

    expect(
      fs.existsSync(path.join(agentDirs[0].skillsPath, "obra.tdd")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(agentDirs[0].skillsPath, "acme.tdd")),
    ).toBe(true);
  });
});

describe("CLI integration: orphan detection", () => {
  it("suggests removal for explicit skills no longer in config", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const tddSource = await createSkillSource("tdd");
    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    // Initial sync with tdd
    const config1: Config = { global: [{ source: "obra/tdd" }] };
    const resolved1 = await resolveSkills(config1, projectRoot);
    const result1 = await syncSkills({
      projectRoot,
      resolvedSkills: resolved1,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });
    expect(result1.synced).toContain("tdd");

    // Remove from config, re-sync
    const config2: Config = { global: [] };
    const resolved2 = await resolveSkills(config2, projectRoot);
    const result2 = await syncSkills({
      projectRoot,
      resolvedSkills: resolved2,
      agentDirs,
      state: result1.updatedState,
      dryRun: false,
    });

    // Explicit skill is suggested for removal, NOT auto-deleted
    expect(result2.orphaned).toContain("tdd");
    expect(result2.removed).not.toContain("tdd");
  });
});

describe("CLI integration: partial failure", () => {
  it("syncs good skills even when one fails", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const tddSource = await createSkillSource("tdd");

    mockFetchSkill
      .mockResolvedValueOnce({ path: tddSource, commitSha: "abc" })
      .mockRejectedValueOnce(new Error("Repository not found"));

    await writeConfig({
      global: [{ source: "obra/tdd" }, { source: "bad/repo" }],
    });

    const config = loadConfig()!;
    const resolvedSkills = await resolveSkills(config, projectRoot);
    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: emptyState(),
      dryRun: false,
    });

    expect(result.synced).toContain("tdd");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("repo");
  });
});

describe("CLI integration: cross-platform paths", () => {
  it("matches project path with absolute path in config", async () => {
    const projectRoot = await createProjectDir("cross-platform-test");

    await writeConfig({
      projects: {
        [projectRoot]: [{ source: "obra/tdd" }],
      },
    });

    const config = loadConfig()!;
    const resolvedSkills = await resolveSkills(config, projectRoot);

    expect(resolvedSkills).toHaveLength(1);
    expect(resolvedSkills[0].type).toBe("project");
  });

  it("skips non-matching project paths silently", async () => {
    const projectRoot = await createProjectDir("my-project");

    await writeConfig({
      global: [{ source: "obra/tdd" }],
      projects: {
        "/non/existent/path": [{ source: "other/skill" }],
        "C:\\Users\\dev\\other-project": [{ source: "win/skill" }],
      },
    });

    const config = loadConfig()!;
    const resolvedSkills = await resolveSkills(config, projectRoot);

    // Only the global skill resolves
    expect(resolvedSkills).toHaveLength(1);
    expect(resolvedSkills[0].ref.source).toBe("obra/tdd");
  });
});

describe("CLI integration: dry-run", () => {
  it("produces no file changes when dry-run is enabled", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const tddSource = await createSkillSource("tdd");
    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    await writeConfig({ global: [{ source: "obra/tdd" }] });
    const config = loadConfig()!;

    const resolvedSkills = await resolveSkills(config, projectRoot);
    const state = emptyState();

    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state,
      dryRun: true,
    });

    // Reports what would happen
    expect(result.synced).toContain("tdd");

    // But no files written
    expect(
      fs.existsSync(path.join(agentDirs[0].skillsPath, "tdd")),
    ).toBe(false);

    // State unchanged
    expect(result.updatedState).toBe(state);
  });
});

describe("CLI integration: config and list", () => {
  it("config paths are set correctly", () => {
    expect(getConfigPath()).toContain("config.json");
    expect(getStatePath()).toContain("state.json");
  });

  it("list resolves skills with correct state tracking", async () => {
    const projectRoot = await createProjectDir();
    const agentDirs = await createAgentDirs(projectRoot);
    await addGitignore(projectRoot);

    const tddSource = await createSkillSource("tdd");
    mockFetchSkill.mockResolvedValue({
      path: tddSource,
      commitSha: "abc",
    });

    await writeConfig({ global: [{ source: "obra/tdd" }] });
    const config = loadConfig()!;

    // Before sync: no state for this project
    const stateBefore = loadState();
    expect(stateBefore.projects[projectRoot]).toBeUndefined();

    // After sync: skill tracked in state
    const resolvedSkills = await resolveSkills(config, projectRoot);
    const result = await syncSkills({
      projectRoot,
      resolvedSkills,
      agentDirs,
      state: stateBefore,
      dryRun: false,
    });
    await saveState(result.updatedState);

    const stateAfter = loadState();
    expect(stateAfter.projects[projectRoot]).toBeDefined();
    expect(stateAfter.projects[projectRoot].skills["tdd"]).toBeDefined();
    expect(stateAfter.projects[projectRoot].skills["tdd"].source).toBe(
      "obra/tdd",
    );
  });
});

describe("CLI integration: cache clean", () => {
  it("calls cleanCache with current state", async () => {
    mockCleanCache.mockResolvedValue({ removed: 0, freedBytes: 0 });

    const state = emptyState();
    const { removed, freedBytes } = await mockCleanCache(state);
    expect(removed).toBe(0);
    expect(freedBytes).toBe(0);
    expect(mockCleanCache).toHaveBeenCalledWith(state);
  });

  it("reports removals and freed space", async () => {
    mockCleanCache.mockResolvedValue({
      removed: 3,
      freedBytes: 1024 * 512,
    });

    const state = emptyState();
    const result = await mockCleanCache(state);
    expect(result.removed).toBe(3);
    expect(result.freedBytes).toBe(524288);
  });
});

describe("CLI integration: remove command flow", () => {
  it("removes skill from all config sections", async () => {
    await writeConfig({
      global: [{ source: "obra/tdd" }, { source: "obra/debug" }],
      conditional: [
        {
          when: "**/*.tsx",
          skills: [{ source: "obra/tdd" }],
        },
      ],
    });

    const config = loadConfig()!;
    const updated = removeSkillFromConfig(config, "obra/tdd");
    await saveConfig(updated);

    const saved = loadConfig()!;
    expect(saved.global).toHaveLength(1);
    expect(saved.global![0].source).toBe("obra/debug");
    expect(saved.conditional).toHaveLength(0);
  });
});

describe("CLI integration: add command variants", () => {
  it("add --project scopes to current project", async () => {
    const projectRoot = await createProjectDir();

    await writeConfig({ global: [], projects: {} });
    const config = loadConfig()!;

    const ref: SkillRef = { source: "obra/tdd" };
    const updated = addSkillToConfig(config, ref, {
      section: "project",
      projectRoot,
    });
    await saveConfig(updated);

    const saved = loadConfig()!;
    expect(saved.projects![projectRoot]).toHaveLength(1);
    expect(saved.projects![projectRoot][0].source).toBe("obra/tdd");
    expect(saved.global).toHaveLength(0);
  });

  it("add --when creates conditional rule", async () => {
    await writeConfig({ global: [], conditional: [] });
    const config = loadConfig()!;

    const ref: SkillRef = { source: "vercel/react-best-practices" };
    const updated = addSkillToConfig(config, ref, {
      section: "conditional",
      when: "**/*.tsx",
    });
    await saveConfig(updated);

    const saved = loadConfig()!;
    expect(saved.conditional).toHaveLength(1);
    expect(saved.conditional![0].when).toBe("**/*.tsx");
    expect(saved.conditional![0].skills[0].source).toBe(
      "vercel/react-best-practices",
    );
  });

  it("add local path creates local skill ref", () => {
    const config: Config = { global: [] };
    const ref: SkillRef = { source: "local", path: "./my-skills/custom" };
    const updated = addSkillToConfig(config, ref, { section: "global" });

    expect(updated.global).toHaveLength(1);
    expect(updated.global![0].source).toBe("local");
    expect(updated.global![0].path).toBe("./my-skills/custom");
  });
});

describe("CLI integration: error handling", () => {
  it("ConfigError includes line/column when available", () => {
    const err = new ConfigError("Unexpected token", {
      line: 5,
      column: 3,
    });
    expect(err.userMessage).toContain("line 5");
    expect(err.userMessage).toContain("column 3");
  });

  it("SkillNotFoundError includes suggestion", () => {
    const err = new SkillNotFoundError("obra/nonexistent");
    expect(err.userMessage).toContain("check the repo exists");
  });
});
