// Entry point + command definitions

import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  ensureConfig,
  loadConfig,
  saveConfig,
  addSkillToConfig,
  removeSkillFromConfig,
} from "./config.js";
import { getProjectRoot, getConfigPath, getStatePath } from "./paths.js";
import { ensureAgentDirs } from "./agents.js";
import { resolveSkills } from "./resolver.js";
import { loadState, saveState } from "./state.js";
import { syncSkills } from "./syncer.js";
import type { SyncResult } from "./syncer.js";
import { fetchSkill, cleanCache } from "./fetcher.js";
import {
  ConfigError,
  FetchError,
  SkillNotFoundError,
} from "./errors.js";
import * as logger from "./logger.js";
import type { SkillRef, AgentDir } from "./types.js";

const ISSUE_URL = "https://github.com/peteretelej/ai-skills-sync/issues";

const program = new Command();

program
  .name("ai-skills-sync")
  .description("AI skills that activate based on your project")
  .version("0.1.1")
  .option("--dry-run", "Preview sync without writing files")
  .option("--no-color", "Disable color output")
  .action(async (opts: { dryRun?: boolean }) => {
    await handleErrors(async () => {
      const config = await ensureConfig();
      const projectRoot = getProjectRoot();
      const agentDirs = await ensureAgentDirs(projectRoot);

      if (agentDirs.length === 0) {
        logger.warn("No agent directories. Nothing to sync.");
        return;
      }

      const projectName = path.basename(projectRoot);
      logger.header(`ai-skills-sync v0.1.1 - ${projectName}`);

      logger.info("  Resolving skills...");
      const resolvedSkills = await resolveSkills(config, projectRoot);

      const globalCount = resolvedSkills.filter(
        (s) => s.type === "global",
      ).length;
      const projectCount = resolvedSkills.filter(
        (s) => s.type === "project",
      ).length;
      const conditionalCount = resolvedSkills.filter(
        (s) => s.type === "conditional",
      ).length;
      const parts: string[] = [];
      if (globalCount) parts.push(`${globalCount} global`);
      if (projectCount) parts.push(`${projectCount} project-specific`);
      if (conditionalCount)
        parts.push(
          `${conditionalCount} conditional match${conditionalCount > 1 ? "es" : ""}`,
        );
      if (parts.length > 0) {
        logger.dim(`    ${parts.join(", ")}`);
      }

      const state = loadState();
      const dryRun = !!opts.dryRun;

      const result = await syncSkills({
        projectRoot,
        resolvedSkills,
        agentDirs,
        state,
        dryRun,
      });

      if (result.alreadyInSync) {
        const n = resolvedSkills.length;
        logger.success(
          `\n  ${n} skill${n !== 1 ? "s" : ""} active. Already in sync.`,
        );
        return;
      }

      if (!dryRun) {
        await saveState(result.updatedState);
      }

      printSyncResult(result, projectRoot, agentDirs);

      if (result.errors.length > 0 && result.synced.length === 0) {
        process.exitCode = 1;
      }
    });
  });

// add command
program
  .command("add <source>")
  .description("Add a skill to your config and sync it")
  .option("--project", "Add to current project only")
  .option("--skill <name>", "Discover skill by name in a monorepo")
  .option("--when <glob>", "Add as conditional skill triggered by file pattern")
  .option("--dry-run", "Preview without writing files")
  .option("--no-color", "Disable color output")
  .action(
    async (
      source: string,
      opts: {
        project?: boolean;
        skill?: string;
        when?: string;
        dryRun?: boolean;
      },
    ) => {
      await handleErrors(async () => {
        const config = await ensureConfig();

        // Parse source type
        let ref: SkillRef;
        if (
          source.startsWith(".") ||
          source.startsWith("/") ||
          source.startsWith("~")
        ) {
          ref = { source: "local", path: source };
        } else {
          ref = { source };
        }

        // Handle --skill flag: discover subpath in monorepo
        if (opts.skill && ref.source !== "local") {
          logger.info(
            `  Discovering skill "${opts.skill}" in ${ref.source}...`,
          );
          const { path: repoPath } = await fetchSkill(ref);
          const skillPath = await findSkillInDirectory(repoPath, opts.skill);
          if (!skillPath) {
            throw new SkillNotFoundError(
              `skill "${opts.skill}" not found in ${ref.source}`,
            );
          }
          ref = { source: ref.source, path: skillPath };
          logger.success(`  Found at ${skillPath}`);
        }

        // Validate the skill exists (fetch it)
        if (!opts.skill) {
          const label = ref.source === "local" ? ref.path! : ref.source;
          logger.info(
            `  Validating ${label}${ref.path && ref.source !== "local" ? ` (${ref.path})` : ""}...`,
          );
          await fetchSkill(ref);
        }

        // Determine config target
        const projectRoot = getProjectRoot();
        let target: Parameters<typeof addSkillToConfig>[2];
        if (opts.when) {
          target = { section: "conditional", when: opts.when };
        } else if (opts.project) {
          target = { section: "project", projectRoot };
        } else {
          target = { section: "global" };
        }

        // Add to config and save
        const updated = addSkillToConfig(config, ref, target);
        const dryRun = !!opts.dryRun;

        if (!dryRun) {
          await saveConfig(updated);
        }

        const label = opts.when
          ? `conditional (${opts.when})`
          : opts.project
            ? "project"
            : "global";
        const refLabel =
          ref.source === "local"
            ? ref.path!
            : ref.source + (ref.path ? ` (${ref.path})` : "");
        logger.success(`  Added ${refLabel} as ${label} skill.`);

        // Sync after adding
        const agentDirs = await ensureAgentDirs(projectRoot);
        if (agentDirs.length > 0) {
          const resolvedSkills = await resolveSkills(updated, projectRoot);
          const state = loadState();
          const result = await syncSkills({
            projectRoot,
            resolvedSkills,
            agentDirs,
            state,
            dryRun,
          });

          if (!dryRun) {
            await saveState(result.updatedState);
          }

          printSyncResult(result, projectRoot, agentDirs);
        }
      });
    },
  );

// remove command
program
  .command("remove <source>")
  .description("Remove a skill from your config")
  .option("--no-color", "Disable color output")
  .action(async (source: string) => {
    await handleErrors(async () => {
      const config = await ensureConfig();
      const updated = removeSkillFromConfig(config, source);
      await saveConfig(updated);
      logger.success(`  Removed ${source} from config.`);
      logger.dim('  Run "ai-skills-sync" to sync changes.');
    });
  });

// list command
program
  .command("list")
  .description("Show active skills for the current project")
  .option("--no-color", "Disable color output")
  .action(async () => {
    await handleErrors(async () => {
      const config = loadConfig();
      if (!config) {
        logger.info('  No config found. Run "ai-skills-sync" to set up.');
        return;
      }

      const projectRoot = getProjectRoot();
      const resolvedSkills = await resolveSkills(config, projectRoot);
      const state = loadState();
      const projectState = state.projects[projectRoot];

      if (resolvedSkills.length === 0) {
        logger.info("  No skills configured for this project.");
        return;
      }

      const projectName = path.basename(projectRoot);
      logger.header(`Skills for ${projectName}`);

      // Build rows
      const rows = resolvedSkills.map((skill) => {
        const installed = projectState?.skills[skill.installName];
        const status = installed ? "synced" : "pending";
        return {
          name: skill.installName,
          source:
            skill.ref.source +
            (skill.ref.path ? ` (${skill.ref.path})` : ""),
          type: skill.type,
          status,
        };
      });

      // Column widths
      const nameW = Math.max(4, ...rows.map((r) => r.name.length));
      const sourceW = Math.max(6, ...rows.map((r) => r.source.length));
      const typeW = Math.max(4, ...rows.map((r) => r.type.length));

      // Header
      logger.dim(
        `  ${"NAME".padEnd(nameW)}  ${"SOURCE".padEnd(sourceW)}  ${"TYPE".padEnd(typeW)}  STATUS`,
      );

      for (const row of rows) {
        const line = `  ${row.name.padEnd(nameW)}  ${row.source.padEnd(sourceW)}  ${row.type.padEnd(typeW)}  ${row.status}`;
        if (row.status === "synced") {
          logger.success(line);
        } else {
          logger.info(line);
        }
      }

      logger.dim(
        `\n  ${resolvedSkills.length} skill${resolvedSkills.length !== 1 ? "s" : ""} total`,
      );
    });
  });

// config command
program
  .command("config")
  .description("Show config and state file locations")
  .option("--no-color", "Disable color output")
  .action(async () => {
    await handleErrors(async () => {
      const configPath = getConfigPath();
      const statePath = getStatePath();

      logger.header("ai-skills-sync config");

      logger.info("  Config file:");
      logger.dim(`    ${configPath}`);

      if (fs.existsSync(configPath)) {
        const content = await fsp.readFile(configPath, "utf-8");
        logger.info("\n  Contents:");
        for (const line of content.split("\n")) {
          logger.dim(`    ${line}`);
        }
      } else {
        logger.dim("    (not created yet)");
      }

      logger.info("\n  State file:");
      logger.dim(`    ${statePath}`);
      if (!fs.existsSync(statePath)) {
        logger.dim("    (not created yet)");
      }
    });
  });

// cache command with clean subcommand
const cacheCmd = program
  .command("cache")
  .description("Cache management");

cacheCmd
  .command("clean")
  .description("Remove stale cache entries")
  .option("--no-color", "Disable color output")
  .action(async () => {
    await handleErrors(async () => {
      const state = loadState();
      logger.info("  Cleaning cache...");
      const { removed, freedBytes } = await cleanCache(state);

      if (removed === 0) {
        logger.success("  Cache is clean. Nothing to remove.");
      } else {
        const sizeStr = formatBytes(freedBytes);
        logger.success(
          `  Removed ${removed} stale cache ${removed === 1 ? "entry" : "entries"} (${sizeStr} freed).`,
        );
      }
    });
  });

program.parseAsync();

// --- Helpers ---

function printSyncResult(
  result: SyncResult,
  projectRoot: string,
  agentDirs: AgentDir[],
): void {
  const agentNames = agentDirs.map(
    (d) => path.relative(projectRoot, d.skillsPath) + "/",
  );

  if (result.synced.length > 0 || result.removed.length > 0) {
    logger.info(`\n  Syncing to ${agentNames.join(", ")}`);
  }

  for (const name of result.synced) {
    logger.success(`    ${name}`);
  }

  for (const name of result.removed) {
    logger.dim(`    - ${name} (removed)`);
  }

  for (const name of result.orphaned) {
    logger.warn(
      `    ! ${name} (no longer in config - run \`ai-skills-sync remove ${name}\` to clean up)`,
    );
  }

  for (const err of result.errors) {
    logger.error(`    x ${err.message}`);
  }

  // .gitignore suggestions
  if (result.gitignoreSuggestions.length > 0) {
    logger.warn(
      "\n  Note: The following paths are not gitignored. Managed skills are third-party",
    );
    logger.warn("  content - consider adding to .gitignore:");
    for (const p of result.gitignoreSuggestions) {
      logger.dim(`    echo '${p}/' >> .gitignore`);
    }
  }

  const total = result.synced.length;
  if (total > 0) {
    logger.success(`\n  Done. ${total} skill${total !== 1 ? "s" : ""} synced.`);
  } else if (result.errors.length > 0) {
    logger.error("\n  Sync failed for all skills.");
  }
}

async function handleErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(`\n  ${err.userMessage}`);
      process.exitCode = 1;
    } else if (err instanceof FetchError) {
      logger.error(`\n  ${err.userMessage}`);
      process.exitCode = 1;
    } else if (err instanceof SkillNotFoundError) {
      logger.error(`\n  ${err.userMessage}`);
      process.exitCode = 1;
    } else {
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      logger.error(`\n  Unexpected error: ${message}`);
      logger.dim(`\n  If this is a bug, please report it at:`);
      logger.dim(`    ${ISSUE_URL}`);
      process.exitCode = 1;
    }
  }
}

/**
 * Recursively search a directory for a subdirectory with a given name
 * that contains a SKILL.md file. Returns relative path from dirPath.
 */
async function findSkillInDirectory(
  dirPath: string,
  skillName: string,
): Promise<string | null> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const entryPath = path.join(dirPath, entry.name);

    if (entry.name === skillName) {
      const skillMd = path.join(entryPath, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        return path.relative(dirPath, entryPath);
      }
    }

    // Recurse into subdirectories
    const found = await findSkillInDirectory(entryPath, skillName);
    if (found) {
      return path.join(entry.name, found);
    }
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
