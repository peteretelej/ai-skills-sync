import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock logger to avoid console output in tests
vi.mock("../src/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  dim: vi.fn(),
  header: vi.fn(),
}));

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
}));

const { detectAgentDirs, promptCreateAgentDirs, ensureAgentDirs } =
  await import("../src/agents.js");
const { checkbox } = await import("@inquirer/prompts");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-agents-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("detectAgentDirs", () => {
  it("returns empty array when no agent dirs exist", () => {
    const result = detectAgentDirs(tmpDir);
    expect(result).toEqual([]);
  });

  it("detects .claude/skills/ directory", async () => {
    await fsp.mkdir(path.join(tmpDir, ".claude", "skills"), { recursive: true });
    const result = detectAgentDirs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("claude");
    expect(result[0].skillsPath).toBe(path.join(tmpDir, ".claude/skills"));
  });

  it("detects .github/skills/ directory", async () => {
    await fsp.mkdir(path.join(tmpDir, ".github", "skills"), { recursive: true });
    const result = detectAgentDirs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("copilot");
  });

  it("detects .cursor/skills/ directory", async () => {
    await fsp.mkdir(path.join(tmpDir, ".cursor", "skills"), { recursive: true });
    const result = detectAgentDirs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("cursor");
  });

  it("detects multiple agent directories", async () => {
    await fsp.mkdir(path.join(tmpDir, ".claude", "skills"), { recursive: true });
    await fsp.mkdir(path.join(tmpDir, ".github", "skills"), { recursive: true });
    await fsp.mkdir(path.join(tmpDir, ".cursor", "skills"), { recursive: true });
    const result = detectAgentDirs(tmpDir);
    expect(result).toHaveLength(3);
    const types = result.map((d) => d.type);
    expect(types).toContain("claude");
    expect(types).toContain("copilot");
    expect(types).toContain("cursor");
  });

  it("ignores parent dirs that exist without skills/ subdirectory", async () => {
    await fsp.mkdir(path.join(tmpDir, ".claude"), { recursive: true });
    const result = detectAgentDirs(tmpDir);
    expect(result).toEqual([]);
  });
});

describe("promptCreateAgentDirs", () => {
  it("creates selected directories", async () => {
    vi.mocked(checkbox).mockResolvedValueOnce([
      { type: "claude", relative: ".claude/skills" },
      { type: "cursor", relative: ".cursor/skills" },
    ] as never);

    const result = await promptCreateAgentDirs(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("claude");
    expect(result[1].type).toBe("cursor");
    expect(fs.existsSync(path.join(tmpDir, ".claude", "skills"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".cursor", "skills"))).toBe(true);
  });

  it("returns empty array when user selects nothing", async () => {
    vi.mocked(checkbox).mockResolvedValueOnce([] as never);

    const result = await promptCreateAgentDirs(tmpDir);
    expect(result).toEqual([]);
  });
});

describe("ensureAgentDirs", () => {
  it("returns existing dirs without prompting", async () => {
    await fsp.mkdir(path.join(tmpDir, ".claude", "skills"), { recursive: true });

    const result = await ensureAgentDirs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("claude");
    expect(checkbox).not.toHaveBeenCalled();
  });

  it("prompts when no dirs exist", async () => {
    vi.mocked(checkbox).mockResolvedValueOnce([
      { type: "copilot", relative: ".github/skills" },
    ] as never);

    const result = await ensureAgentDirs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("copilot");
    expect(checkbox).toHaveBeenCalled();
  });
});
