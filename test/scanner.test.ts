import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ConditionalRule } from "../src/types.js";

const { scanForConditionalMatches } = await import("../src/scanner.js");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aiss-scanner-test-"));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

describe("scanForConditionalMatches", () => {
  it("returns matching rules when files match the glob", async () => {
    await fsp.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, "src", "App.tsx"), "");

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toHaveLength(1);
    expect(matched[0].when).toBe("**/*.tsx");
  });

  it("returns empty array when no files match", async () => {
    await fsp.writeFile(path.join(tmpDir, "index.js"), "");

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toEqual([]);
  });

  it("returns multiple matching rules", async () => {
    await fsp.writeFile(path.join(tmpDir, "main.tf"), "");
    await fsp.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, "src", "App.tsx"), "");

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
      { when: "**/*.tf", skills: [{ source: "hashicorp/terraform-patterns" }] },
      { when: "**/*.py", skills: [{ source: "python/best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toHaveLength(2);
    const patterns = matched.map((r) => r.when);
    expect(patterns).toContain("**/*.tsx");
    expect(patterns).toContain("**/*.tf");
  });

  it("returns empty array when rules list is empty", async () => {
    const matched = await scanForConditionalMatches(tmpDir, []);
    expect(matched).toEqual([]);
  });

  it("excludes node_modules from scanning", async () => {
    await fsp.mkdir(path.join(tmpDir, "node_modules", "pkg"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmpDir, "node_modules", "pkg", "index.tsx"),
      "",
    );

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toEqual([]);
  });

  it("excludes .git directory from scanning", async () => {
    await fsp.mkdir(path.join(tmpDir, ".git", "hooks"), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, ".git", "hooks", "pre-commit.sh"), "");

    const rules: ConditionalRule[] = [
      { when: "**/*.sh", skills: [{ source: "shell/scripts" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toEqual([]);
  });

  it("excludes dist and build directories", async () => {
    await fsp.mkdir(path.join(tmpDir, "dist"), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, "dist", "bundle.tsx"), "");
    await fsp.mkdir(path.join(tmpDir, "build"), { recursive: true });
    await fsp.writeFile(path.join(tmpDir, "build", "output.tsx"), "");

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toEqual([]);
  });

  it("matches files in non-excluded subdirectories", async () => {
    await fsp.mkdir(path.join(tmpDir, "src", "components"), { recursive: true });
    await fsp.writeFile(
      path.join(tmpDir, "src", "components", "Button.tsx"),
      "",
    );

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toHaveLength(1);
  });

  it("matches root-level files", async () => {
    await fsp.writeFile(path.join(tmpDir, "main.tf"), "");

    const rules: ConditionalRule[] = [
      { when: "*.tf", skills: [{ source: "hashicorp/terraform-patterns" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched).toHaveLength(1);
  });

  it("returns the full ConditionalRule objects (not just patterns)", async () => {
    await fsp.writeFile(path.join(tmpDir, "app.tsx"), "");

    const rules: ConditionalRule[] = [
      {
        when: "**/*.tsx",
        skills: [
          { source: "vercel/react-best-practices" },
          { source: "react/hooks" },
        ],
      },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    expect(matched[0].skills).toHaveLength(2);
    expect(matched[0].skills[0].source).toBe("vercel/react-best-practices");
    expect(matched[0].skills[1].source).toBe("react/hooks");
  });

  it("early-exits after first match per rule (does not need all files)", async () => {
    // Create many matching files - the scanner should still stop after the first
    for (let i = 0; i < 10; i++) {
      await fsp.writeFile(path.join(tmpDir, `file${i}.tsx`), "");
    }

    const rules: ConditionalRule[] = [
      { when: "**/*.tsx", skills: [{ source: "vercel/react-best-practices" }] },
    ];

    const matched = await scanForConditionalMatches(tmpDir, rules);
    // Should match exactly once (not 10 times)
    expect(matched).toHaveLength(1);
  });
});
