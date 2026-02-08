import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SyncState, ResolvedSkill } from "../src/types.js";

let tmpDir: string;

vi.mock("../src/paths.js", () => ({
  getStatePath: () => path.join(tmpDir, "state.json"),
}));

const {
  loadState,
  saveState,
  getProjectState,
  updateProjectState,
  isInSync,
  getOrphanedSkills,
  getManagedSkillNames,
} = await import("../src/state.js");

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-state-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("loadState", () => {
  it("returns empty default state when file is missing", () => {
    const state = loadState();
    expect(state).toEqual({ version: 1, lastSync: "", projects: {} });
  });

  it("parses existing state file", async () => {
    const existing: SyncState = {
      version: 1,
      lastSync: "2026-02-08T00:00:00Z",
      projects: {
        "/home/user/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };
    await fsp.writeFile(
      path.join(tmpDir, "state.json"),
      JSON.stringify(existing),
    );
    const state = loadState();
    expect(state).toEqual(existing);
  });
});

describe("saveState", () => {
  it("writes state to disk with 2-space indent", async () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    await saveState(state);
    const raw = fs.readFileSync(path.join(tmpDir, "state.json"), "utf-8");
    expect(raw).toContain('  "version"');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(state);
  });

  it("creates parent directories if needed", async () => {
    const originalTmpDir = tmpDir;
    tmpDir = path.join(originalTmpDir, "nested", "dir");
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    await saveState(state);
    expect(fs.existsSync(path.join(tmpDir, "state.json"))).toBe(true);
    tmpDir = originalTmpDir;
  });
});

describe("round-trip", () => {
  it("save then load returns equivalent state", async () => {
    const state: SyncState = {
      version: 1,
      lastSync: "2026-02-08T12:00:00Z",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T12:00:00Z",
              agents: ["claude", "copilot"],
              type: "global",
            },
          },
        },
      },
    };
    await saveState(state);
    expect(loadState()).toEqual(state);
  });
});

describe("getProjectState", () => {
  it("returns project state when it exists", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };
    const proj = getProjectState(state, "/app");
    expect(Object.keys(proj.skills)).toEqual(["tdd"]);
  });

  it("returns empty default when project not found", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    const proj = getProjectState(state, "/nonexistent");
    expect(proj).toEqual({ skills: {} });
  });
});

describe("updateProjectState", () => {
  it("sets skills for a project", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    const updated = updateProjectState(state, "/app", {
      tdd: {
        source: "obra/tdd",
        syncedAt: "2026-02-08T00:00:00Z",
        agents: ["claude"],
        type: "global",
      },
    });
    expect(Object.keys(updated.projects["/app"].skills)).toEqual(["tdd"]);
  });

  it("overwrites existing project state", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            old: {
              source: "old/skill",
              syncedAt: "2026-01-01T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };
    const updated = updateProjectState(state, "/app", {
      new: {
        source: "new/skill",
        syncedAt: "2026-02-08T00:00:00Z",
        agents: ["claude"],
        type: "project",
      },
    });
    expect(Object.keys(updated.projects["/app"].skills)).toEqual(["new"]);
  });

  it("does not mutate the original state", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    updateProjectState(state, "/app", {
      tdd: {
        source: "obra/tdd",
        syncedAt: "2026-02-08T00:00:00Z",
        agents: ["claude"],
        type: "global",
      },
    });
    expect(state.projects).toEqual({});
  });
});

describe("isInSync", () => {
  const resolved: ResolvedSkill[] = [
    { ref: { source: "obra/tdd" }, type: "global", installName: "tdd" },
    {
      ref: { source: "sentry/code-review" },
      type: "project",
      installName: "code-review",
    },
  ];

  it("returns true when resolved matches state", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
            "code-review": {
              source: "sentry/code-review",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "project",
            },
          },
        },
      },
    };
    expect(isInSync(state, "/app", resolved)).toBe(true);
  });

  it("returns false when skill count differs", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };
    expect(isInSync(state, "/app", resolved)).toBe(false);
  });

  it("returns false when source differs", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "different/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
            "code-review": {
              source: "sentry/code-review",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "project",
            },
          },
        },
      },
    };
    expect(isInSync(state, "/app", resolved)).toBe(false);
  });

  it("returns false when project not in state", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    expect(isInSync(state, "/app", resolved)).toBe(false);
  });

  it("returns true for empty resolved and empty state", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    expect(isInSync(state, "/app", [])).toBe(true);
  });

  it("returns false when path differs", () => {
    const resolvedWithPath: ResolvedSkill[] = [
      {
        ref: { source: "microsoft/skills", path: ".github/skills/cosmos" },
        type: "project",
        installName: "cosmos",
      },
    ];
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            cosmos: {
              source: "microsoft/skills",
              path: ".github/skills/other",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "project",
            },
          },
        },
      },
    };
    expect(isInSync(state, "/app", resolvedWithPath)).toBe(false);
  });
});

describe("getOrphanedSkills", () => {
  it("finds skills in state not in resolved set", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
            "old-skill": {
              source: "old/removed",
              syncedAt: "2026-01-01T00:00:00Z",
              agents: ["claude"],
              type: "conditional",
            },
          },
        },
      },
    };
    const resolved: ResolvedSkill[] = [
      { ref: { source: "obra/tdd" }, type: "global", installName: "tdd" },
    ];
    const orphans = getOrphanedSkills(state, "/app", resolved);
    expect(orphans).toEqual(["old-skill"]);
  });

  it("returns empty array when nothing is orphaned", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
          },
        },
      },
    };
    const resolved: ResolvedSkill[] = [
      { ref: { source: "obra/tdd" }, type: "global", installName: "tdd" },
    ];
    expect(getOrphanedSkills(state, "/app", resolved)).toEqual([]);
  });

  it("returns empty array when project not in state", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    expect(getOrphanedSkills(state, "/app", [])).toEqual([]);
  });
});

describe("getManagedSkillNames", () => {
  it("returns directory names of managed skills", () => {
    const state: SyncState = {
      version: 1,
      lastSync: "",
      projects: {
        "/app": {
          skills: {
            tdd: {
              source: "obra/tdd",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "global",
            },
            "code-review": {
              source: "sentry/code-review",
              syncedAt: "2026-02-08T00:00:00Z",
              agents: ["claude"],
              type: "project",
            },
          },
        },
      },
    };
    const names = getManagedSkillNames(state, "/app");
    expect(names).toEqual(["tdd", "code-review"]);
  });

  it("returns empty array when project not in state", () => {
    const state: SyncState = { version: 1, lastSync: "", projects: {} };
    expect(getManagedSkillNames(state, "/app")).toEqual([]);
  });
});
