---
title: CLI Reference
description: All ai-skills-sync commands, flags, and usage examples
---

# CLI Reference

## Default Command (Sync)

```bash
npx ai-skills-sync [--dry-run] [--no-color]
```

Syncs skills to the current project. Resolves which skills apply (global, project-specific, conditional), fetches any that are missing, and copies them to detected agent directories.

If everything is already in sync, it exits early with a status message.

**Examples:**

```bash
# Sync skills for the current project
npx ai-skills-sync

# Preview what would change without writing files
npx ai-skills-sync --dry-run
```

## add

```bash
npx ai-skills-sync add <source> [flags]
```

Add a skill to your config and sync it immediately.

**Arguments:**

| Argument | Description |
|----------|-------------|
| `source` | Skill source. Either `owner/repo` for GitHub, `owner/repo@ref` for a pinned version, or a local path (starting with `.`, `/`, or `~`) |

**Flags:**

| Flag | Description |
|------|-------------|
| `--project` | Add to the current project only (instead of globally) |
| `--skill <name>` | Discover a skill by directory name within a monorepo |
| `--when <glob>` | Add as a conditional skill triggered by a file pattern |
| `--dry-run` | Preview without writing files |
| `--no-color` | Disable color output |

**Examples:**

```bash
# Add a skill globally (synced to every project)
npx ai-skills-sync add anthropics/skills --skill frontend-design

# Add to the current project only
npx ai-skills-sync add supabase/agent-skills --project

# Add a specific skill from a monorepo
npx ai-skills-sync add anthropics/skills --skill skill-creator

# Add a conditional skill (activates when .tsx files exist)
npx ai-skills-sync add expo/skills --when "**/*.tsx"

# Add a pinned version
npx ai-skills-sync add anthropics/skills@main --skill frontend-design

# Add a local skill
npx ai-skills-sync add ~/my-skills/custom-linter
```

## remove

```bash
npx ai-skills-sync remove <source> [--no-color]
```

Remove a skill from your config. This removes all instances of the skill (global, project-specific, and conditional). Run `npx ai-skills-sync` afterward to clean up the synced files.

**Examples:**

```bash
npx ai-skills-sync remove anthropics/skills
```

## list

```bash
npx ai-skills-sync list [--no-color]
```

Show all skills that apply to the current project, including their source, type (global/project/conditional), and sync status.

**Example output:**

```
Skills for my-project

  NAME                    SOURCE                              TYPE         STATUS
  frontend-design         anthropics/skills                   global       synced
  skills                  expo/skills                         conditional  synced

  2 skills total
```

## config

```bash
npx ai-skills-sync config [--no-color]
```

Display the config and state file locations, plus the current config contents. Useful for debugging or verifying your setup.

## cache clean

```bash
npx ai-skills-sync cache clean [--no-color]
```

Remove cached skill downloads that are no longer referenced by any active project state. Reports how many entries were removed and how much disk space was freed.

## Global Flags

These flags work with any command:

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what would happen without writing files |
| `--no-color` | Disable color output (also respects the `NO_COLOR` environment variable) |

## Agent Detection

When you run `ai-skills-sync` in a project, it detects which agent directories exist:

| Agent | Directory |
|-------|-----------|
| Agent Skills standard | `.agents/skills/` |
| OpenCode | `.opencode/skills/` |
| Claude Code | `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/skills/` |

If none exist, you'll be prompted to choose which to create. Skills are synced to all detected agent directories.
