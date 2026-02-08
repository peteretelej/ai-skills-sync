// Copy skills to agent directories

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fetchSkill } from "./fetcher.js";
import {
  isInSync,
  getProjectState,
  getOrphanedSkills,
} from "./state.js";
import { SyncError } from "./errors.js";
import * as logger from "./logger.js";
import type {
  ResolvedSkill,
  AgentDir,
  SyncState,
  InstalledSkill,
  AgentType,
} from "./types.js";

export interface SyncParams {
  projectRoot: string;
  resolvedSkills: ResolvedSkill[];
  agentDirs: AgentDir[];
  state: SyncState;
  dryRun: boolean;
}

export interface SyncResult {
  synced: string[];
  removed: string[];
  orphaned: string[];
  errors: SyncError[];
  alreadyInSync: boolean;
  gitignoreSuggestions: string[];
  updatedState: SyncState;
}

/**
 * Copy a skill directory to a destination, overwriting if it exists.
 */
export async function copySkillToDir(
  src: string,
  dest: string,
): Promise<void> {
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.cp(src, dest, { recursive: true });
}

/**
 * Rewrite the `name` field in a SKILL.md frontmatter.
 * Only called on namespace collision (dot-prefixed names).
 */
export async function rewriteSkillName(
  skillMdPath: string,
  newName: string,
): Promise<void> {
  const content = await fsp.readFile(skillMdPath, "utf-8");

  // Must have frontmatter delimiters
  if (!content.startsWith("---")) return;

  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) return;

  const frontmatter = content.slice(0, endIndex + 3);
  const rest = content.slice(endIndex + 3);

  // Replace name field within frontmatter
  const updated = frontmatter.replace(
    /^(name:\s*).+$/m,
    `$1${newName}`,
  );

  if (updated !== frontmatter) {
    await fsp.writeFile(skillMdPath, updated + rest);
  }
}

/**
 * Remove a managed skill directory.
 */
export async function removeSkillDir(dirPath: string): Promise<void> {
  await fsp.rm(dirPath, { recursive: true, force: true });
}

/**
 * Check which agent skill paths are not covered by .gitignore.
 * Uses simple pattern matching against .gitignore entries.
 */
export async function checkGitignore(
  projectRoot: string,
  agentDirs: AgentDir[],
): Promise<string[]> {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  let lines: string[] = [];
  try {
    const content = await fsp.readFile(gitignorePath, "utf-8");
    lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    // No .gitignore means all paths are uncovered
    return agentDirs.map((d) => path.relative(projectRoot, d.skillsPath));
  }

  const uncovered: string[] = [];

  for (const dir of agentDirs) {
    const relative = path.relative(projectRoot, dir.skillsPath);
    const isCovered = lines.some((line) => {
      const clean = line.replace(/\/+$/, "");
      return relative === clean || relative.startsWith(clean + "/");
    });

    if (!isCovered) {
      uncovered.push(relative);
    }
  }

  return uncovered;
}

/**
 * Main sync orchestrator. Fetches skills, copies to agent directories,
 * handles orphans, checks .gitignore, and returns updated state.
 */
export async function syncSkills(params: SyncParams): Promise<SyncResult> {
  const { projectRoot, resolvedSkills, agentDirs, state, dryRun } = params;

  const result: SyncResult = {
    synced: [],
    removed: [],
    orphaned: [],
    errors: [],
    alreadyInSync: false,
    gitignoreSuggestions: [],
    updatedState: state,
  };

  // 1. Early exit if already in sync
  if (isInSync(state, projectRoot, resolvedSkills)) {
    result.alreadyInSync = true;
    return result;
  }

  const projectState = getProjectState(state, projectRoot);
  const managedNames = new Set(Object.keys(projectState.skills));
  const newSkills: Record<string, InstalledSkill> = {};

  // 2. For each resolved skill: fetch and copy to agent dirs
  for (const skill of resolvedSkills) {
    try {
      const { path: sourcePath, commitSha } = await fetchSkill(skill.ref);

      const syncedAgents: AgentType[] = [];
      for (const agentDir of agentDirs) {
        const destDir = path.join(agentDir.skillsPath, skill.installName);

        // Skip if directory exists and is NOT managed by state
        if (fs.existsSync(destDir) && !managedNames.has(skill.installName)) {
          logger.warn(
            `  Skipping ${skill.installName} in ${agentDir.type}: directory exists and is not managed`,
          );
          continue;
        }

        if (dryRun) {
          logger.dim(
            `  [dry-run] Would copy ${skill.ref.source} -> ${path.relative(projectRoot, destDir)}`,
          );
        } else {
          await copySkillToDir(sourcePath, destDir);

          // Rewrite name on namespace collision (dot-prefixed)
          if (skill.installName.includes(".")) {
            const skillMdPath = path.join(destDir, "SKILL.md");
            if (fs.existsSync(skillMdPath)) {
              await rewriteSkillName(skillMdPath, skill.installName);
            }
          }
        }

        syncedAgents.push(agentDir.type);
      }

      if (syncedAgents.length > 0) {
        result.synced.push(skill.installName);
        newSkills[skill.installName] = {
          source: skill.ref.source,
          path: skill.ref.path,
          commitSha,
          syncedAt: new Date().toISOString(),
          agents: syncedAgents,
          type: skill.type,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(new SyncError(`${skill.installName}: ${message}`));
      logger.error(`  Failed to sync ${skill.installName}: ${message}`);

      // Preserve old state entry if this skill was previously synced
      if (projectState.skills[skill.installName]) {
        newSkills[skill.installName] = projectState.skills[skill.installName];
      }
    }
  }

  // 3. Detect and handle orphaned skills
  const orphanNames = getOrphanedSkills(state, projectRoot, resolvedSkills);
  for (const name of orphanNames) {
    const installed = projectState.skills[name];
    if (!installed) continue;

    if (installed.type === "conditional") {
      // Auto-remove conditional orphans
      if (dryRun) {
        logger.dim(
          `  [dry-run] Would remove orphaned conditional skill: ${name}`,
        );
      } else {
        for (const agentDir of agentDirs) {
          await removeSkillDir(path.join(agentDir.skillsPath, name));
        }
      }
      result.removed.push(name);
    } else {
      // Suggest removal for explicit orphans (keep in state)
      result.orphaned.push(name);
      newSkills[name] = installed;
    }
  }

  // 4. Check .gitignore coverage (one-time per project)
  if (!projectState.gitignoreSuggested) {
    const uncovered = await checkGitignore(projectRoot, agentDirs);
    if (uncovered.length > 0) {
      result.gitignoreSuggestions = uncovered;
    }
  }

  // 5. Build updated state
  const updatedState = structuredClone(state);
  updatedState.lastSync = new Date().toISOString();
  updatedState.projects[projectRoot] = {
    skills: dryRun ? projectState.skills : newSkills,
    gitignoreSuggested:
      projectState.gitignoreSuggested ||
      result.gitignoreSuggestions.length > 0,
  };

  result.updatedState = dryRun ? state : updatedState;

  return result;
}
