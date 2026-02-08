# ai-skills-sync

Per-project AI skill routing for coding agents. Define which skills belong where in a single config, then sync them to agent directories (`.claude/skills/`, `.github/skills/`, `.cursor/skills/`).

## Quick Start

```bash
# Run in any project directory - creates config on first run
npx ai-skills-sync

# Add a skill globally (synced to every project)
npx ai-skills-sync add obra/tdd

# Add a skill to the current project only
npx ai-skills-sync add sentry/code-review --project
```

## Why

The Agent Skills ecosystem has tools for installing skills, but none solve **per-project skill selection from a single config**. Without routing:

- 40 skills in `.claude/skills/` means 40 descriptions in every system prompt
- Global install pushes every skill to every project regardless of relevance
- Developers manually copy/remove skills per project

`ai-skills-sync` sits one layer above existing tools: they handle "get this skill onto my machine," this handles "put the right skills in the right project directories."

## Config

A single JSON file at `~/.config/ai-skills-sync/config.json` (respects `XDG_CONFIG_HOME`; `%APPDATA%\ai-skills-sync\config.json` on Windows).

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json",

  // Skills synced to every project
  "global": [
    { "source": "obra/tdd" },
    { "source": "obra/systematic-debugging" }
  ],

  // Skills for specific projects only
  "projects": {
    "~/work/platform-services": [
      { "source": "microsoft/skills", "path": ".github/skills/azure-cosmos-db-py" },
      { "source": "sentry/code-review" }
    ],
    "~/projects/acme-dashboard": [
      { "source": "vercel/react-best-practices" }
    ]
  },

  // Skills auto-activated when matching files exist
  "conditional": [
    {
      "when": "**/*.tsx",
      "skills": [{ "source": "vercel/react-best-practices" }]
    },
    {
      "when": "*.tf",
      "skills": [{ "source": "hashicorp/terraform-patterns" }]
    }
  ]
}
```

### Skill Reference Format

| Config | Meaning |
|--------|---------|
| `{ "source": "obra/tdd" }` | Root skill from GitHub, latest version |
| `{ "source": "obra/tdd@v1.2" }` | Pinned to a git tag, branch, or commit |
| `{ "source": "microsoft/skills", "path": ".github/skills/azure-cosmos-db-py" }` | Monorepo subpath |
| `{ "source": "local", "path": "~/my-skills/custom" }` | Local filesystem skill |

## CLI Reference

| Command | Description |
|---------|-------------|
| `npx ai-skills-sync` | Sync skills for the current project |
| `npx ai-skills-sync add <source>` | Add a skill globally |
| `npx ai-skills-sync add <source> --project` | Add to current project only |
| `npx ai-skills-sync add <source> --skill <name>` | Discover and add a skill from a monorepo |
| `npx ai-skills-sync add <source> --when "<glob>"` | Add as conditional skill |
| `npx ai-skills-sync add ./path/to/skill` | Add a local skill |
| `npx ai-skills-sync remove <source>` | Remove a skill from config |
| `npx ai-skills-sync list` | Show active skills for current project |
| `npx ai-skills-sync config` | Show config and state file locations |
| `npx ai-skills-sync cache clean` | Remove stale cache entries |

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what sync would do without writing files |
| `--no-color` | Disable color output |

## How Sync Works

```
npx ai-skills-sync
  |
  +- Read config (~/.config/ai-skills-sync/config.json)
  +- Find project root (walk up to .git)
  +- Resolve applicable skills:
  |   +- Global skills (always included)
  |   +- Project-specific skills (if cwd matches a projects entry)
  |   +- Conditional skills (scan files for glob matches)
  +- For each resolved skill:
  |   +- Check cache, fetch from GitHub if missing
  |   +- Copy to detected agent directories
  +- Remove conditional skills whose globs no longer match
  +- Suggest cleanup for explicit skills removed from config
  +- Write sync state
```

### Agent Detection

Skills are synced to all detected agent directories:

| Agent | Directory |
|-------|-----------|
| Claude Code | `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/skills/` |

If no agent directories exist, you'll be prompted to choose which to create.

### Namespace Collisions

If two sources provide a skill with the same name, directories are prefixed with the org using dot notation: `obra.tdd/`, `acme.tdd/`. When only one skill has a given name, it installs without a prefix.

## FAQ

**How does this work with `npx skills` (Vercel)?**
They're complementary. Use `npx skills` to discover and install skills. Use `ai-skills-sync` to route the right skills to the right projects.

**What agents are supported?**
Any agent that reads skills from filesystem directories. Built-in support for Claude Code, GitHub Copilot, and Cursor.

**Are conditional skills removed automatically?**
Yes. Conditional skills are ephemeral: synced when their glob matches, removed when it doesn't. Explicitly-added skills (global/project) are never auto-deleted; you'll get a suggestion to clean up instead.

**Does this modify my .gitignore?**
No. If synced skill directories aren't gitignored, the tool prints a suggestion but never modifies `.gitignore` itself.

**What about private repos?**
Skills are fetched via `git clone`, so your existing git credentials (SSH keys, credential helpers) work automatically. The tool never stores or prompts for credentials.

**What about Windows?**
Cross-platform paths are handled via `env-paths`. Windows paths in config are supported alongside Unix paths - paths that don't exist on the current platform are silently skipped.

## Requirements

- Node.js >= 22
- Git (for fetching skills from GitHub)

## License

MIT
