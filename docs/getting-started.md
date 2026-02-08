---
title: Getting Started
description: Install ai-skills-sync and sync your first skills
---

# Getting Started

This guide walks you through installing `ai-skills-sync`, adding your first skills, and syncing them to a project.

## Install

`ai-skills-sync` runs via `npx`, so there's nothing to install globally. You just need:

- **Node.js** >= 22
- **Git** (for fetching skills from GitHub)

## First Run

Navigate to any git project and run:

```bash
npx ai-skills-sync
```

On first run, you'll be prompted to create a configuration file. Choose "Create config with recommended defaults" to get started with an empty config ready to fill.

The config is created at `~/.config/ai-skills-sync/config.json` (or `%APPDATA%\ai-skills-sync\config.json` on Windows).

## Add Your First Skill

Add a skill that will be available in every project:

```bash
npx ai-skills-sync add anthropics/skills --skill frontend-design
```

This does three things:
1. Fetches the skill from GitHub (`anthropics/skills`) and locates the `frontend-design` skill
2. Adds it to the `global` section of your config
3. Syncs it to the current project's agent directories

## Add a Project-Specific Skill

Some skills only make sense in certain projects. Add one to just the current project:

```bash
npx ai-skills-sync add supabase/agent-skills --project
```

This skill will only sync when you run `ai-skills-sync` from this specific project directory.

## Add a Conditional Skill

Conditional skills activate automatically based on files in the project:

```bash
npx ai-skills-sync add expo/skills --when "**/*.tsx"
```

Now any project containing `.tsx` files will automatically get this skill. Projects without `.tsx` files won't. When you remove all `.tsx` files from a project, the skill is automatically cleaned up on the next sync.

## Check What's Active

See which skills are configured for the current project:

```bash
npx ai-skills-sync list
```

## What Happened

After running these commands, `ai-skills-sync` has:

- Created a config file at `~/.config/ai-skills-sync/config.json`
- Fetched skills from GitHub and cached them locally
- Copied skill files to your project's agent directories (`.claude/skills/`, `.github/skills/`, `.cursor/skills/`, depending on which agents you use)
- Saved sync state so it can detect changes on the next run

## Next Steps

- Run `npx ai-skills-sync` in any project to sync the right skills
- See [CLI Reference](./cli-reference.md) for all available commands
- See [Configuration](./configuration.md) for advanced config options
- See [Conditional Skills](./conditional-skills.md) to learn about automatic activation
