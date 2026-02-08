// Agent directory detection

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { checkbox } from "@inquirer/prompts";
import type { AgentType, AgentDir } from "./types.js";
import * as logger from "./logger.js";

const AGENT_DIRS: { type: AgentType; relative: string }[] = [
  { type: "agents", relative: ".agents/skills" },
  { type: "opencode", relative: ".opencode/skills" },
  { type: "claude", relative: ".claude/skills" },
  { type: "copilot", relative: ".github/skills" },
  { type: "cursor", relative: ".cursor/skills" },
];

export function detectAgentDirs(projectRoot: string): AgentDir[] {
  const found: AgentDir[] = [];
  for (const agent of AGENT_DIRS) {
    const skillsPath = path.join(projectRoot, agent.relative);
    if (fs.existsSync(skillsPath)) {
      found.push({ type: agent.type, skillsPath });
    }
  }
  return found;
}

export async function promptCreateAgentDirs(
  projectRoot: string,
): Promise<AgentDir[]> {
  logger.info("No agent skill directories found in this project.");

  const choices = AGENT_DIRS.map((agent) => ({
    name: `${agent.type} (${agent.relative}/)`,
    value: agent,
  }));

  const selected = await checkbox({
    message: "Which agent directories would you like to create?",
    choices,
  });

  if (selected.length === 0) {
    logger.warn("No directories selected. Skipping.");
    return [];
  }

  const created: AgentDir[] = [];
  for (const agent of selected) {
    const skillsPath = path.join(projectRoot, agent.relative);
    await fsp.mkdir(skillsPath, { recursive: true });
    created.push({ type: agent.type, skillsPath });
    logger.success(`  Created ${agent.relative}/`);
  }

  return created;
}

export async function ensureAgentDirs(
  projectRoot: string,
): Promise<AgentDir[]> {
  const existing = detectAgentDirs(projectRoot);
  if (existing.length > 0) {
    return existing;
  }
  return promptCreateAgentDirs(projectRoot);
}
