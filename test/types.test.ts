import { describe, it, expect } from "vitest";
import {
  parseSource,
  formatSource,
  skillRefToRepoUrl,
  deriveSkillName,
} from "../src/types.js";

describe("parseSource", () => {
  it("parses owner/repo", () => {
    expect(parseSource("obra/tdd")).toEqual({ owner: "obra", repo: "tdd" });
  });

  it("parses owner/repo@ref", () => {
    expect(parseSource("obra/tdd@v1.2")).toEqual({
      owner: "obra",
      repo: "tdd",
      ref: "v1.2",
    });
  });

  it("parses owner/repo@branch", () => {
    expect(parseSource("microsoft/skills@main")).toEqual({
      owner: "microsoft",
      repo: "skills",
      ref: "main",
    });
  });

  it("parses source without ref (ref is undefined)", () => {
    const result = parseSource("sentry/code-review");
    expect(result.ref).toBeUndefined();
  });

  it('returns local sentinel for "local" source', () => {
    const result = parseSource("local");
    expect(result.owner).toBe("local");
    expect(result.repo).toBe("local");
  });

  it("throws on missing slash", () => {
    expect(() => parseSource("invalid")).toThrow("Invalid source format");
  });

  it("throws on empty owner", () => {
    expect(() => parseSource("/repo")).toThrow("owner and repo must not be empty");
  });

  it("throws on empty repo", () => {
    expect(() => parseSource("owner/")).toThrow("owner and repo must not be empty");
  });
});

describe("formatSource", () => {
  it("formats owner/repo", () => {
    expect(formatSource({ owner: "obra", repo: "tdd" })).toBe("obra/tdd");
  });

  it("formats owner/repo@ref", () => {
    expect(formatSource({ owner: "obra", repo: "tdd", ref: "v1.2" })).toBe(
      "obra/tdd@v1.2"
    );
  });

  it('formats local as "local"', () => {
    expect(formatSource({ owner: "local", repo: "local" })).toBe("local");
  });

  it("round-trips with parseSource", () => {
    const sources = ["obra/tdd", "obra/tdd@v1.2", "microsoft/skills@main", "local"];
    for (const source of sources) {
      expect(formatSource(parseSource(source))).toBe(source);
    }
  });
});

describe("skillRefToRepoUrl", () => {
  it("builds GitHub HTTPS URL", () => {
    expect(skillRefToRepoUrl({ source: "obra/tdd" })).toBe(
      "https://github.com/obra/tdd.git"
    );
  });

  it("builds URL ignoring ref", () => {
    expect(skillRefToRepoUrl({ source: "obra/tdd@v1.2" })).toBe(
      "https://github.com/obra/tdd.git"
    );
  });

  it("builds URL with path (path is not in URL)", () => {
    expect(
      skillRefToRepoUrl({
        source: "microsoft/skills",
        path: ".github/skills/azure-cosmos-db-py",
      })
    ).toBe("https://github.com/microsoft/skills.git");
  });
});

describe("deriveSkillName", () => {
  it("derives name from root skill (repo name)", () => {
    expect(deriveSkillName({ source: "obra/tdd" })).toBe("tdd");
  });

  it("derives name from monorepo subpath", () => {
    expect(
      deriveSkillName({
        source: "microsoft/skills",
        path: ".github/skills/azure-cosmos-db-py",
      })
    ).toBe("azure-cosmos-db-py");
  });

  it("derives name from local path", () => {
    expect(
      deriveSkillName({ source: "local", path: "~/my-skills/custom" })
    ).toBe("custom");
  });

  it("derives name from skill with ref", () => {
    expect(deriveSkillName({ source: "obra/tdd@v1.2" })).toBe("tdd");
  });

  it("uses path over source when path is set", () => {
    expect(
      deriveSkillName({ source: "obra/tdd", path: "skills/special" })
    ).toBe("special");
  });
});
