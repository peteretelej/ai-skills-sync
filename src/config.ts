// Config read/write/locate

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { select } from "@inquirer/prompts";
import { getConfigPath } from "./paths.js";
import { ConfigError } from "./errors.js";
import * as logger from "./logger.js";
import type { Config, SkillRef } from "./types.js";

const SCHEMA_URL =
  "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json";

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): Config | null {
  const configPath = getConfigPath();
  let raw: string;

  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }

  try {
    return JSON.parse(raw) as Config;
  } catch (err: unknown) {
    const parseErr = err as SyntaxError;
    // Extract line/column from JSON parse error message
    // Node's JSON.parse errors include "at position N" or "at line X column Y"
    const lineCol = extractLineColumn(parseErr.message, raw);
    throw new ConfigError(parseErr.message, lineCol);
  }
}

function extractLineColumn(
  message: string,
  raw: string,
): { line: number; column: number } | undefined {
  // Node 22 JSON parse errors include "at line X column Y"
  const lineColMatch = message.match(/at line (\d+) column (\d+)/);
  if (lineColMatch) {
    return {
      line: parseInt(lineColMatch[1], 10),
      column: parseInt(lineColMatch[2], 10),
    };
  }

  // Older Node versions use "at position N"
  const posMatch = message.match(/at position (\d+)/);
  if (posMatch) {
    const pos = parseInt(posMatch[1], 10);
    const before = raw.slice(0, pos);
    const lines = before.split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }

  return undefined;
}

export async function saveConfig(config: Config): Promise<void> {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  await fsp.mkdir(dir, { recursive: true });

  const toWrite: Config = { $schema: SCHEMA_URL, ...config };
  toWrite.$schema = SCHEMA_URL;

  await fsp.writeFile(configPath, JSON.stringify(toWrite, null, 2) + "\n");
}

export async function ensureConfig(): Promise<Config> {
  const existing = loadConfig();
  if (existing) return existing;

  const configPath = getConfigPath();
  logger.header("ai-skills-sync");
  logger.info("  No configuration found. Let's set one up.\n");
  logger.info(`  Config will be created at:`);
  logger.dim(`    ${configPath}\n`);

  const choice = await select({
    message: "What would you like to do?",
    choices: [
      {
        name: "Create config with recommended defaults",
        value: "defaults",
      },
      { name: "Create empty config", value: "empty" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (choice === "cancel") {
    throw new ConfigError("Setup cancelled by user.");
  }

  let config: Config;
  if (choice === "defaults") {
    config = {
      global: [],
      projects: {},
      conditional: [],
    };
  } else {
    config = {};
  }

  await saveConfig(config);
  logger.success("\n  Config created.\n");
  logger.info("  Next steps:");
  logger.dim("    ai-skills-sync add obra/tdd              Add a skill globally");
  logger.dim(
    "    ai-skills-sync add obra/tdd --project    Add to this project only",
  );
  logger.dim(
    "    ai-skills-sync list                      Show active skills\n",
  );

  return loadConfig()!;
}

export function addSkillToConfig(
  config: Config,
  ref: SkillRef,
  target:
    | { section: "global" }
    | { section: "project"; projectRoot: string }
    | { section: "conditional"; when: string },
): Config {
  const updated = structuredClone(config);

  switch (target.section) {
    case "global": {
      if (!updated.global) updated.global = [];
      updated.global.push(ref);
      break;
    }
    case "project": {
      if (!updated.projects) updated.projects = {};
      const key = target.projectRoot;
      if (!updated.projects[key]) updated.projects[key] = [];
      updated.projects[key].push(ref);
      break;
    }
    case "conditional": {
      if (!updated.conditional) updated.conditional = [];
      const existing = updated.conditional.find(
        (rule) => rule.when === target.when,
      );
      if (existing) {
        existing.skills.push(ref);
      } else {
        updated.conditional.push({ when: target.when, skills: [ref] });
      }
      break;
    }
  }

  return updated;
}

export function removeSkillFromConfig(config: Config, source: string): Config {
  const updated = structuredClone(config);

  if (updated.global) {
    updated.global = updated.global.filter((r) => r.source !== source);
  }

  if (updated.projects) {
    for (const key of Object.keys(updated.projects)) {
      updated.projects[key] = updated.projects[key].filter(
        (r) => r.source !== source,
      );
    }
  }

  if (updated.conditional) {
    for (const rule of updated.conditional) {
      rule.skills = rule.skills.filter((r) => r.source !== source);
    }
    updated.conditional = updated.conditional.filter(
      (rule) => rule.skills.length > 0,
    );
  }

  return updated;
}
