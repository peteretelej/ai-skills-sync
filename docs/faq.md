---
title: FAQ
description: Frequently asked questions about ai-skills-sync
---

# FAQ

## General

### What agents are supported?

Any agent that reads skills from filesystem directories. Built-in support for:

| Agent | Directory |
|-------|-----------|
| Agent Skills standard | `.agents/skills/` |
| OpenCode | `.opencode/skills/` |
| Claude Code | `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/skills/` |

If your agent reads skills from a different directory, [open an issue](https://github.com/peteretelej/ai-skills-sync/issues) and we can add support.

### Does this replace Vercel's `npx skills`?

No. They're complementary. `npx skills` helps you discover and install skills. `ai-skills-sync` helps you control which skills are active in which projects. You can use both together.

### What about the Agent Skills open standard?

`ai-skills-sync` works with any skill that follows the [Agent Skills](https://agentskills.io) standard (a directory containing a `SKILL.md` file). This is the same format used by Claude Code, GitHub Copilot, Cursor, and other tools.

## Skills

### Are conditional skills removed automatically?

Yes. Conditional skills are ephemeral: synced when their glob matches files in the project, removed when it doesn't. This happens on every sync.

Global and project-specific skills are never auto-deleted. If you remove them from config, the tool suggests cleanup instead.

### What about private repos?

Skills are fetched via `git clone`, so your existing git credentials (SSH keys, credential helpers) work automatically. The tool never stores or prompts for credentials.

### Can I pin a skill to a specific version?

Yes. Append `@ref` to the source:

```bash
npx ai-skills-sync add anthropics/skills@v1.2 --skill frontend-design
```

This pins to a git tag, branch, or commit SHA.

### What happens with namespace collisions?

If two different sources provide a skill with the same directory name, install directories are prefixed with the owner:

- `anthropics.frontend-design/`
- `acme.frontend-design/`

When only one skill has a given name, it installs without a prefix.

## Config and State

### Where is the config file?

| Platform | Path |
|----------|------|
| macOS / Linux | `~/.config/ai-skills-sync/config.json` |
| Windows | `%APPDATA%\ai-skills-sync\config.json` |

Run `npx ai-skills-sync config` to see the exact path.

### Can I check the config into git?

The config lives in your home directory, not in any project. It's personal to you. If you want to share skill configurations with a team, each team member runs their own `ai-skills-sync` setup.

### Does this modify my .gitignore?

No. If synced skill directories aren't gitignored, the tool prints a suggestion but never modifies `.gitignore` itself. Since synced skills are third-party content, it's generally a good idea to gitignore them.

## Caching

### Where are skills cached?

| Platform | Path |
|----------|------|
| macOS | `~/Library/Caches/ai-skills-sync/` |
| Linux | `~/.cache/ai-skills-sync/` |
| Windows | `%LOCALAPPDATA%\ai-skills-sync\Cache\` |

### How do I force a fresh fetch?

Clear the cache and re-sync:

```bash
npx ai-skills-sync cache clean
npx ai-skills-sync
```

### What about Windows?

Cross-platform paths are handled via the `env-paths` library. Windows paths in config are supported alongside Unix paths. Paths that don't exist on the current platform are silently skipped.

## Troubleshooting

### "No agent directories found"

This means no `.agents/skills/`, `.opencode/skills/`, `.claude/skills/`, `.github/skills/`, or `.cursor/skills/` directory exists in the project. The tool will prompt you to create one. Choose the agents you use.

### "Git clone failed"

Check that:
- The skill source (`owner/repo`) exists on GitHub
- You have network access
- For private repos, your git credentials are configured (SSH keys or credential helper)

### "Subpath not found"

The `path` you specified doesn't exist in the repository. Double-check the path or use `--skill` to discover skills by name:

```bash
npx ai-skills-sync add anthropics/skills --skill frontend-design
```
