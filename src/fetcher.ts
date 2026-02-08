// Git clone + cache management

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { getCacheDir, expandHome } from "./paths.js";
import { FetchError, SkillNotFoundError } from "./errors.js";
import { parseSource, skillRefToRepoUrl } from "./types.js";
import type { ParsedSource, SkillRef, SyncState } from "./types.js";

const CLONE_TIMEOUT_MS = 60_000;

// Track temp dirs for cleanup on exit/SIGINT
const pendingCleanups = new Set<string>();
let cleanupRegistered = false;

function ensureCleanupHandlers(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    for (const dir of pendingCleanups) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
    pendingCleanups.clear();
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
}

/**
 * Register a temp directory for cleanup on exit/SIGINT.
 */
export function registerCleanup(tempDir: string): void {
  ensureCleanupHandlers();
  pendingCleanups.add(tempDir);
}

/**
 * Remove a temp dir from the cleanup set (after successful cleanup).
 */
function unregisterCleanup(tempDir: string): void {
  pendingCleanups.delete(tempDir);
}

/**
 * Build a deterministic temp dir path from a source string.
 */
function getTempDir(source: string): string {
  const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `ai-skills-sync-${hash}`);
}

/**
 * Build the cache path for a fetched skill.
 */
export function getCachePath(parsed: ParsedSource, commitSha: string, subpath?: string): string {
  const base = path.join(getCacheDir(), "github", parsed.owner, parsed.repo, commitSha);
  return subpath ? path.join(base, subpath) : base;
}

/**
 * Check if any cached version exists for a remote skill source.
 * Returns the path to the cached skill or null.
 */
export function findCachedSkill(ref: SkillRef): string | null {
  const parsed = parseSource(ref.source);
  const repoDir = path.join(getCacheDir(), "github", parsed.owner, parsed.repo);

  if (!fs.existsSync(repoDir)) return null;

  let entries: string[];
  try {
    entries = fs.readdirSync(repoDir);
  } catch {
    return null;
  }

  // Find first commit SHA directory
  for (const entry of entries) {
    const entryPath = path.join(repoDir, entry);
    const stat = fs.statSync(entryPath, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      const skillPath = ref.path ? path.join(entryPath, ref.path) : entryPath;
      if (fs.existsSync(skillPath)) {
        return skillPath;
      }
    }
  }

  return null;
}

/**
 * Resolve a local skill reference to an absolute path.
 */
export function resolveLocalSkill(ref: SkillRef): string {
  if (!ref.path) {
    throw new SkillNotFoundError("local skill requires a path");
  }

  const expanded = expandHome(ref.path);
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(expanded);

  if (!fs.existsSync(resolved)) {
    throw new SkillNotFoundError(`local path "${ref.path}" does not exist`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new SkillNotFoundError(`local path "${ref.path}" is not a directory`);
  }

  return resolved;
}

/**
 * Clone a remote repo and extract the skill to cache.
 */
export async function cloneAndExtract(ref: SkillRef): Promise<{ cachePath: string; commitSha: string }> {
  const parsed = parseSource(ref.source);
  const repoUrl = skillRefToRepoUrl(ref);
  const tempDir = getTempDir(ref.source);

  // Clean up any previous failed attempt at this temp dir
  await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  registerCleanup(tempDir);

  try {
    // Build clone args
    const cloneArgs = ["clone", "--depth", "1"];
    if (parsed.ref) {
      cloneArgs.push("--branch", parsed.ref);
    }
    cloneArgs.push(repoUrl, tempDir);

    // Clone with timeout and no terminal prompt
    await execa("git", cloneArgs, {
      timeout: CLONE_TIMEOUT_MS,
      env: { GIT_TERMINAL_PROMPT: "0" },
    });

    // Read commit SHA
    const { stdout: commitSha } = await execa("git", ["rev-parse", "HEAD"], {
      cwd: tempDir,
    });

    // Verify subpath if specified
    const sourceDir = ref.path ? path.join(tempDir, ref.path) : tempDir;
    if (ref.path) {
      if (!fs.existsSync(sourceDir)) {
        throw new SkillNotFoundError(
          `subpath "${ref.path}" not found in ${parsed.owner}/${parsed.repo}`,
        );
      }
    }

    // Build cache destination and copy
    const cachePath = getCachePath(parsed, commitSha.trim(), ref.path);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.cp(sourceDir, cachePath, { recursive: true });

    // Clean up temp dir
    await fsp.rm(tempDir, { recursive: true, force: true });
    unregisterCleanup(tempDir);

    return { cachePath, commitSha: commitSha.trim() };
  } catch (err) {
    // Clean up temp dir on error
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    unregisterCleanup(tempDir);

    if (err instanceof SkillNotFoundError) throw err;

    const message = err instanceof Error ? err.message : String(err);
    throw new FetchError(
      `Failed to fetch ${parsed.owner}/${parsed.repo}: ${message}`,
    );
  }
}

/**
 * Main entry point: fetch a skill, returning the path to its files.
 * For local refs, resolves directly. For remote refs, checks cache first.
 */
export async function fetchSkill(ref: SkillRef): Promise<{ path: string; commitSha?: string }> {
  // Local skills: resolve directly, never cached
  if (ref.source === "local") {
    return { path: resolveLocalSkill(ref) };
  }

  // Check cache first
  const cached = findCachedSkill(ref);
  if (cached) {
    return { path: cached };
  }

  // Cache miss: clone and extract
  const { cachePath, commitSha } = await cloneAndExtract(ref);
  return { path: cachePath, commitSha };
}

/**
 * Walk the cache directory and remove entries not referenced by any active
 * project state. Returns stats about what was removed.
 */
export async function cleanCache(state: SyncState): Promise<{ removed: number; freedBytes: number }> {
  const cacheDir = getCacheDir();
  const githubDir = path.join(cacheDir, "github");

  if (!fs.existsSync(githubDir)) {
    return { removed: 0, freedBytes: 0 };
  }

  // Collect all commit SHAs referenced by active state
  const activeShas = new Set<string>();
  for (const project of Object.values(state.projects)) {
    for (const skill of Object.values(project.skills)) {
      if (skill.commitSha) {
        activeShas.add(skill.commitSha);
      }
    }
  }

  let removed = 0;
  let freedBytes = 0;

  // Walk: github/{owner}/{repo}/{sha}/
  const owners = await fsp.readdir(githubDir).catch(() => [] as string[]);
  for (const owner of owners) {
    const ownerDir = path.join(githubDir, owner);
    const stat = await fsp.stat(ownerDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const repos = await fsp.readdir(ownerDir).catch(() => [] as string[]);
    for (const repo of repos) {
      const repoDir = path.join(ownerDir, repo);
      const repoStat = await fsp.stat(repoDir).catch(() => null);
      if (!repoStat?.isDirectory()) continue;

      const shas = await fsp.readdir(repoDir).catch(() => [] as string[]);
      for (const sha of shas) {
        if (activeShas.has(sha)) continue;

        const shaDir = path.join(repoDir, sha);
        const shaStat = await fsp.stat(shaDir).catch(() => null);
        if (!shaStat?.isDirectory()) continue;

        // Calculate size before removing
        const size = await getDirSize(shaDir);
        await fsp.rm(shaDir, { recursive: true, force: true });
        removed++;
        freedBytes += size;
      }

      // Clean up empty repo/owner dirs
      const remaining = await fsp.readdir(repoDir).catch(() => ["x"]);
      if (remaining.length === 0) {
        await fsp.rm(repoDir, { recursive: true, force: true });
      }
    }

    const remainingRepos = await fsp.readdir(ownerDir).catch(() => ["x"]);
    if (remainingRepos.length === 0) {
      await fsp.rm(ownerDir, { recursive: true, force: true });
    }
  }

  return { removed, freedBytes };
}

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirSize(entryPath);
    } else {
      const stat = await fsp.stat(entryPath).catch(() => null);
      if (stat) total += stat.size;
    }
  }
  return total;
}

// Export for testing
export { pendingCleanups, getTempDir };
