import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Config } from "../src/types.js";

// Mock paths to use temp directories
let tmpDir: string;

vi.mock("../src/paths.js", () => ({
  getConfigPath: () => path.join(tmpDir, "config.json"),
  getStatePath: () => path.join(tmpDir, "state.json"),
}));

// Mock logger to avoid console output in tests
vi.mock("../src/logger.js", () => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  dim: vi.fn(),
  header: vi.fn(),
}));

const {
  loadConfig,
  saveConfig,
  configExists,
  addSkillToConfig,
  removeSkillFromConfig,
} = await import("../src/config.js");

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-config-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("configExists", () => {
  it("returns false when no config file exists", () => {
    expect(configExists()).toBe(false);
  });

  it("returns true when config file exists", async () => {
    await fsp.writeFile(
      path.join(tmpDir, "config.json"),
      JSON.stringify({}),
    );
    expect(configExists()).toBe(true);
  });
});

describe("loadConfig", () => {
  it("returns null when config file is missing", () => {
    expect(loadConfig()).toBeNull();
  });

  it("parses valid config JSON", async () => {
    const config: Config = {
      global: [{ source: "obra/tdd" }],
      projects: {},
      conditional: [],
    };
    await fsp.writeFile(
      path.join(tmpDir, "config.json"),
      JSON.stringify(config),
    );
    expect(loadConfig()).toEqual(config);
  });

  it("throws ConfigError with line/column on invalid JSON", async () => {
    await fsp.writeFile(
      path.join(tmpDir, "config.json"),
      '{\n  "global": [\n    { bad json }\n  ]\n}',
    );
    expect(() => loadConfig()).toThrow();
    try {
      loadConfig();
    } catch (err: unknown) {
      const e = err as { name: string; line?: number; column?: number };
      expect(e.name).toBe("ConfigError");
      expect(e.line).toBeDefined();
      expect(e.column).toBeDefined();
    }
  });
});

describe("saveConfig", () => {
  it("creates parent directories if they don't exist", async () => {
    // tmpDir already exists, but the mock path is directly in tmpDir
    // so this tests the mkdir recursive call
    const config: Config = { global: [] };
    await saveConfig(config);
    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(true);
  });

  it("sets $schema on every save", async () => {
    const config: Config = { global: [] };
    await saveConfig(config);
    const raw = fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved.$schema).toBe(
      "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json",
    );
  });

  it("overwrites existing $schema with correct value", async () => {
    const config: Config = {
      $schema: "wrong-schema-url",
      global: [],
    };
    await saveConfig(config);
    const raw = fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved.$schema).toBe(
      "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json",
    );
  });

  it("writes with 2-space indent", async () => {
    const config: Config = { global: [{ source: "obra/tdd" }] };
    await saveConfig(config);
    const raw = fs.readFileSync(path.join(tmpDir, "config.json"), "utf-8");
    expect(raw).toContain('  "global"');
  });

  it("creates deeply nested parent directories", async () => {
    // Temporarily change tmpDir to a nested path
    const originalTmpDir = tmpDir;
    tmpDir = path.join(originalTmpDir, "nested", "deep", "dir");
    const config: Config = { global: [] };
    await saveConfig(config);
    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(true);
    tmpDir = originalTmpDir;
  });
});

describe("round-trip", () => {
  it("save then load returns equivalent config", async () => {
    const config: Config = {
      global: [{ source: "obra/tdd" }, { source: "obra/systematic-debugging" }],
      projects: {
        "~/projects/app": [{ source: "vercel/react-best-practices" }],
      },
      conditional: [
        {
          when: "**/*.tsx",
          skills: [{ source: "vercel/react-best-practices" }],
        },
      ],
    };
    await saveConfig(config);
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.global).toEqual(config.global);
    expect(loaded!.projects).toEqual(config.projects);
    expect(loaded!.conditional).toEqual(config.conditional);
    expect(loaded!.$schema).toBeDefined();
  });
});

describe("addSkillToConfig", () => {
  it("adds skill to global section", () => {
    const config: Config = { global: [{ source: "obra/tdd" }] };
    const updated = addSkillToConfig(config, { source: "sentry/code-review" }, { section: "global" });
    expect(updated.global).toHaveLength(2);
    expect(updated.global![1].source).toBe("sentry/code-review");
  });

  it("creates global section if missing", () => {
    const config: Config = {};
    const updated = addSkillToConfig(config, { source: "obra/tdd" }, { section: "global" });
    expect(updated.global).toHaveLength(1);
  });

  it("adds skill to project section", () => {
    const config: Config = { projects: {} };
    const updated = addSkillToConfig(
      config,
      { source: "sentry/code-review" },
      { section: "project", projectRoot: "~/work/app" },
    );
    expect(updated.projects!["~/work/app"]).toHaveLength(1);
    expect(updated.projects!["~/work/app"][0].source).toBe("sentry/code-review");
  });

  it("creates projects section if missing", () => {
    const config: Config = {};
    const updated = addSkillToConfig(
      config,
      { source: "obra/tdd" },
      { section: "project", projectRoot: "/foo" },
    );
    expect(updated.projects!["/foo"]).toHaveLength(1);
  });

  it("adds skill to existing conditional rule", () => {
    const config: Config = {
      conditional: [
        { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
      ],
    };
    const updated = addSkillToConfig(
      config,
      { source: "new/skill" },
      { section: "conditional", when: "**/*.tsx" },
    );
    expect(updated.conditional).toHaveLength(1);
    expect(updated.conditional![0].skills).toHaveLength(2);
  });

  it("creates new conditional rule if when pattern is new", () => {
    const config: Config = { conditional: [] };
    const updated = addSkillToConfig(
      config,
      { source: "hashicorp/terraform-patterns" },
      { section: "conditional", when: "*.tf" },
    );
    expect(updated.conditional).toHaveLength(1);
    expect(updated.conditional![0].when).toBe("*.tf");
    expect(updated.conditional![0].skills).toHaveLength(1);
  });

  it("does not mutate the original config", () => {
    const config: Config = { global: [{ source: "obra/tdd" }] };
    addSkillToConfig(config, { source: "new/skill" }, { section: "global" });
    expect(config.global).toHaveLength(1);
  });
});

describe("removeSkillFromConfig", () => {
  it("removes from global section", () => {
    const config: Config = {
      global: [{ source: "obra/tdd" }, { source: "sentry/code-review" }],
    };
    const updated = removeSkillFromConfig(config, "obra/tdd");
    expect(updated.global).toHaveLength(1);
    expect(updated.global![0].source).toBe("sentry/code-review");
  });

  it("removes from projects section", () => {
    const config: Config = {
      projects: {
        "~/app": [{ source: "obra/tdd" }, { source: "sentry/code-review" }],
      },
    };
    const updated = removeSkillFromConfig(config, "obra/tdd");
    expect(updated.projects!["~/app"]).toHaveLength(1);
  });

  it("removes from conditional section", () => {
    const config: Config = {
      conditional: [
        { when: "**/*.tsx", skills: [{ source: "obra/tdd" }] },
      ],
    };
    const updated = removeSkillFromConfig(config, "obra/tdd");
    // Empty conditional rules are removed entirely
    expect(updated.conditional).toHaveLength(0);
  });

  it("removes from all sections at once", () => {
    const config: Config = {
      global: [{ source: "obra/tdd" }],
      projects: { "~/app": [{ source: "obra/tdd" }] },
      conditional: [
        { when: "**/*.tsx", skills: [{ source: "obra/tdd" }, { source: "other/skill" }] },
      ],
    };
    const updated = removeSkillFromConfig(config, "obra/tdd");
    expect(updated.global).toHaveLength(0);
    expect(updated.projects!["~/app"]).toHaveLength(0);
    expect(updated.conditional).toHaveLength(1);
    expect(updated.conditional![0].skills).toHaveLength(1);
  });

  it("does not mutate the original config", () => {
    const config: Config = { global: [{ source: "obra/tdd" }] };
    removeSkillFromConfig(config, "obra/tdd");
    expect(config.global).toHaveLength(1);
  });
});
