---
title: How It Works
description: Under the hood - resolution algorithm, caching, agent detection, and sync state
---

# How It Works

This page explains what happens when you run `npx ai-skills-sync`.

## Sync Flow

```
npx ai-skills-sync
  |
  +-- Read config (~/.config/ai-skills-sync/config.json)
  +-- Find project root (walk up to nearest .git)
  +-- Detect agent directories (.claude/skills/, .github/skills/, .cursor/skills/)
  +-- Resolve applicable skills:
  |     +-- Global skills (always included)
  |     +-- Project-specific skills (if cwd matches a projects entry)
  |     +-- Conditional skills (scan project files for glob matches)
  +-- Deduplicate (project > global > conditional priority)
  +-- Handle namespace collisions (prefix with owner if needed)
  +-- For each resolved skill:
  |     +-- Check cache, fetch from GitHub if missing
  |     +-- Copy to all detected agent directories
  +-- Remove orphaned conditional skills (auto-cleanup)
  +-- Suggest cleanup for orphaned explicit skills
  +-- Check .gitignore coverage
  +-- Save sync state
```

## Skill Resolution

The resolver collects skills from three sources:

1. **Global** - All skills in `config.global`
2. **Project-specific** - Skills in `config.projects[currentProjectPath]`
3. **Conditional** - Skills from `config.conditional` rules where the glob pattern matches at least one file in the project

After collecting, skills are deduplicated. If the same skill (same source + path) appears in multiple sections, the higher-priority entry wins: project > global > conditional.

## Agent Detection

On each sync, the tool checks which agent skill directories exist in the project root:

| Agent | Directory |
|-------|-----------|
| Agent Skills standard | `.agents/skills/` |
| OpenCode | `.opencode/skills/` |
| Claude Code | `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/skills/` |

If no agent directories exist, you're prompted to choose which to create. Skills are copied to all detected directories, so if you use both Claude Code and Cursor, both get the same skills.

## Fetching and Caching

When a skill needs to be fetched from GitHub:

1. A shallow `git clone --depth 1` fetches the repository (with `--branch` if a ref is specified)
2. The skill directory is extracted and cached at `~/.cache/ai-skills-sync/github/{owner}/{repo}/{commitSha}/`
3. The temporary clone is cleaned up

On subsequent syncs, the cached version is used. To fetch a fresh copy, clear the cache:

```bash
npx ai-skills-sync cache clean
```

Local skills (source: `"local"`) are copied directly from the specified path and are never cached.

### Cache Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Caches/ai-skills-sync/` |
| Linux | `~/.cache/ai-skills-sync/` |
| Windows | `%LOCALAPPDATA%\ai-skills-sync\Cache\` |

## Sync State

After each sync, the tool saves state to `~/.config/ai-skills-sync/state.json`. This tracks:

- Which skills are installed in each project
- The commit SHA of each fetched skill
- When each skill was last synced
- Which agent directories each skill was synced to
- The skill type (global, project, conditional)

The state is used to:

- **Skip syncing** when nothing has changed (early exit for fast re-runs)
- **Detect orphaned skills** that are in state but no longer in config
- **Clean cache** by identifying which cached SHAs are still in use

## Orphan Handling

An orphaned skill is one that exists in the sync state but is no longer resolved from the config (e.g., you removed it from config, or a conditional pattern no longer matches).

- **Conditional orphans** are automatically removed from agent directories. Since they're ephemeral by design, cleaning them up is safe.
- **Explicit orphans** (global or project-specific) are not auto-deleted. Instead, the tool prints a suggestion to clean up manually. This prevents accidentally deleting skills you may have temporarily removed from config.

## .gitignore Suggestions

On the first sync in a project, the tool checks whether agent skill directories are covered by `.gitignore`. Since synced skills are third-party content fetched from GitHub, they generally shouldn't be committed. If uncovered paths are found, the tool prints suggestions:

```
echo '.claude/skills/' >> .gitignore
echo '.github/skills/' >> .gitignore
```

The tool never modifies `.gitignore` itself.

## Temp Directory Cleanup

During `git clone` operations, temporary directories are created in the system's temp folder. Signal handlers ensure these are cleaned up on exit or interruption (SIGINT), so interrupted syncs don't leave behind orphaned temp directories.
