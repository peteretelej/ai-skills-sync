import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Config } from "../src/types.js";

const { resolveSkills, deduplicateSkills, resolveInstallNames } = await import(
  "../src/resolver.js"
);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-resolver-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveSkills", () => {
  it("resolves global-only config", async () => {
    const config: Config = {
      global: [
        { source: "obra/tdd" },
        { source: "obra/systematic-debugging" },
      ],
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      ref: { source: "obra/tdd" },
      type: "global",
      installName: "tdd",
    });
    expect(result[1]).toMatchObject({
      ref: { source: "obra/systematic-debugging" },
      type: "global",
      installName: "systematic-debugging",
    });
  });

  it("resolves project-only config", async () => {
    const config: Config = {
      projects: {
        [tmpDir]: [
          { source: "sentry/code-review" },
          {
            source: "microsoft/skills",
            path: ".github/skills/azure-cosmos-db-py",
          },
        ],
      },
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      ref: { source: "sentry/code-review" },
      type: "project",
      installName: "code-review",
    });
    expect(result[1]).toMatchObject({
      ref: {
        source: "microsoft/skills",
        path: ".github/skills/azure-cosmos-db-py",
      },
      type: "project",
      installName: "azure-cosmos-db-py",
    });
  });

  it("resolves mixed global + project + conditional", async () => {
    // Create a .tsx file so conditional matches
    await fsp.writeFile(path.join(tmpDir, "App.tsx"), "");

    const config: Config = {
      global: [{ source: "obra/tdd" }],
      projects: {
        [tmpDir]: [{ source: "sentry/code-review" }],
      },
      conditional: [
        {
          when: "**/*.tsx",
          skills: [{ source: "vercel/react-best-practices" }],
        },
      ],
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toHaveLength(3);

    const types = result.map((r) => r.type);
    expect(types).toContain("global");
    expect(types).toContain("project");
    expect(types).toContain("conditional");

    const names = result.map((r) => r.installName);
    expect(names).toContain("tdd");
    expect(names).toContain("code-review");
    expect(names).toContain("react-best-practices");
  });

  it("matches project by exact path", async () => {
    const config: Config = {
      projects: {
        [tmpDir]: [{ source: "obra/tdd" }],
        "/some/other/path": [{ source: "acme/other" }],
      },
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].ref.source).toBe("obra/tdd");
  });

  it("matches project with ~ expansion", async () => {
    const home = os.homedir();
    // Create a temp dir under home
    const homeDir = await fsp.mkdtemp(path.join(home, ".aiss-resolver-test-"));
    try {
      const relativePath = "~" + homeDir.slice(home.length);
      const config: Config = {
        projects: {
          [relativePath]: [{ source: "obra/tdd" }],
        },
      };

      const result = await resolveSkills(config, homeDir);
      expect(result).toHaveLength(1);
      expect(result[0].ref.source).toBe("obra/tdd");
    } finally {
      await fsp.rm(homeDir, { recursive: true, force: true });
    }
  });

  it("skips non-matching project path", async () => {
    const config: Config = {
      projects: {
        "/nonexistent/path": [{ source: "obra/tdd" }],
      },
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toEqual([]);
  });

  it("resolves conditional matching glob", async () => {
    await fsp.writeFile(path.join(tmpDir, "main.tf"), "");

    const config: Config = {
      conditional: [
        {
          when: "**/*.tf",
          skills: [{ source: "hashicorp/terraform-patterns" }],
        },
      ],
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ref: { source: "hashicorp/terraform-patterns" },
      type: "conditional",
      installName: "terraform-patterns",
    });
  });

  it("skips conditional when glob does not match", async () => {
    // No .tf files in tmpDir
    const config: Config = {
      conditional: [
        {
          when: "**/*.tf",
          skills: [{ source: "hashicorp/terraform-patterns" }],
        },
      ],
    };

    const result = await resolveSkills(config, tmpDir);
    expect(result).toEqual([]);
  });

  it("handles empty/missing config sections", async () => {
    // All undefined
    const result1 = await resolveSkills({}, tmpDir);
    expect(result1).toEqual([]);

    // Explicit undefined
    const result2 = await resolveSkills(
      { global: undefined, projects: undefined, conditional: undefined },
      tmpDir,
    );
    expect(result2).toEqual([]);

    // Empty arrays/objects
    const result3 = await resolveSkills(
      { global: [], projects: {}, conditional: [] },
      tmpDir,
    );
    expect(result3).toEqual([]);
  });
});

describe("deduplicateSkills", () => {
  it("keeps global over conditional when same skill appears in both", () => {
    const skills = [
      { ref: { source: "obra/tdd" }, type: "global" as const },
      { ref: { source: "obra/tdd" }, type: "conditional" as const },
    ];

    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("global");
  });

  it("keeps project over global when same skill appears in both", () => {
    const skills = [
      { ref: { source: "obra/tdd" }, type: "global" as const },
      { ref: { source: "obra/tdd" }, type: "project" as const },
    ];

    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("project");
  });

  it("treats different paths as different skills", () => {
    const skills = [
      {
        ref: { source: "microsoft/skills", path: ".github/skills/skill-a" },
        type: "global" as const,
      },
      {
        ref: { source: "microsoft/skills", path: ".github/skills/skill-b" },
        type: "global" as const,
      },
    ];

    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(2);
  });

  it("keeps project over conditional when same skill appears in both", () => {
    const skills = [
      { ref: { source: "vercel/react-best-practices" }, type: "conditional" as const },
      { ref: { source: "vercel/react-best-practices" }, type: "project" as const },
    ];

    const result = deduplicateSkills(skills);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("project");
  });
});

describe("resolveInstallNames", () => {
  it("uses base name when no collision", () => {
    const skills = [
      { ref: { source: "obra/tdd" }, type: "global" as const },
      { ref: { source: "sentry/code-review" }, type: "global" as const },
    ];

    const result = resolveInstallNames(skills);
    expect(result).toHaveLength(2);
    expect(result[0].installName).toBe("tdd");
    expect(result[1].installName).toBe("code-review");
  });

  it("dot-prefixes on namespace collision", () => {
    const skills = [
      { ref: { source: "obra/tdd" }, type: "global" as const },
      { ref: { source: "acme/tdd" }, type: "project" as const },
    ];

    const result = resolveInstallNames(skills);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.installName).sort();
    expect(names).toEqual(["acme.tdd", "obra.tdd"]);
  });

  it("single tdd installs as tdd not obra.tdd", () => {
    const skills = [{ ref: { source: "obra/tdd" }, type: "global" as const }];

    const result = resolveInstallNames(skills);
    expect(result).toHaveLength(1);
    expect(result[0].installName).toBe("tdd");
  });

  it("uses path basename for monorepo skills", () => {
    const skills = [
      {
        ref: {
          source: "microsoft/skills",
          path: ".github/skills/azure-cosmos-db-py",
        },
        type: "project" as const,
      },
    ];

    const result = resolveInstallNames(skills);
    expect(result[0].installName).toBe("azure-cosmos-db-py");
  });

  it("handles collision between monorepo subpaths with same basename", () => {
    const skills = [
      {
        ref: {
          source: "microsoft/skills",
          path: ".github/skills/tdd",
        },
        type: "project" as const,
      },
      {
        ref: { source: "obra/tdd" },
        type: "global" as const,
      },
    ];

    const result = resolveInstallNames(skills);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.installName).sort();
    expect(names).toEqual(["microsoft.tdd", "obra.tdd"]);
  });
});
