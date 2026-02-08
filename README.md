# ai-skills-sync

**AI skills that activate based on your project, so your agent's context goes to what matters.**

[![npm version](https://img.shields.io/npm/v/ai-skills-sync)](https://www.npmjs.com/package/ai-skills-sync)
[![CI](https://github.com/peteretelej/ai-skills-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/peteretelej/ai-skills-sync/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ai-skills-sync?style=flat)](./LICENSE)

Every installed [AI skill](https://agentskills.io/specification) competes for your agent's limited context window. Install too many globally, and relevant skills get crowded out by irrelevant ones. As more companies ship skills to replace their APIs and docs, this only gets worse.

`ai-skills-sync` gives you one config file that controls which skills are active where:

- **Global** - skills synced to every project (e.g., TDD, debugging)
- **Project-specific** - skills that only appear in the repos that need them
- **Conditional** - skills that auto-activate based on your files (React skills when `.tsx` exists, Terraform skills when `.tf` exists)

## Quick Start

```bash
# Run in any project directory - creates config on first run
npx ai-skills-sync
```

## CLI

### Adding Skills

```bash
# Add a skill globally (synced to every project)
npx ai-skills-sync add anthropics/skills --skill frontend-design

# Add a local skill globally (will be synced to every project)
npx ai-skills-sync add ~/my-skills/code-review

# Add a local skill to the current project only
npx ai-skills-sync add "C:\my-local-skills\code-review" --project

# Add a conditional skill - activates only when matching files exist in a project
npx ai-skills-sync add expo/skills --when "**/*.tsx"
npx ai-skills-sync add cloudflare/skills --when "wrangler.toml"

# Add a skill to the current project only
npx ai-skills-sync add supabase/agent-skills --project

# Pin to a specific version
npx ai-skills-sync add anthropics/skills@main --skill frontend-design
```

Running `npx ai-skills-sync` resolves which skills apply to the current project and copies them into all detected agent directories (`.claude/skills/`, `.cursor/skills/`, etc.). Global skills are always synced, conditional skills activate only when their file patterns match, and project-specific skills appear only where assigned.

### Managing Skills

```bash
# Sync skills for the current project
npx ai-skills-sync

# Preview what sync would do without writing files
npx ai-skills-sync --dry-run

# Show active skills for the current project
npx ai-skills-sync list

# Remove a skill from config
npx ai-skills-sync remove anthropics/skills

# Show config and state file locations
npx ai-skills-sync config

# Clean up stale cache entries
npx ai-skills-sync cache clean
```

### Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview what sync would do without writing files |
| `--no-color` | Disable color output (also respects `NO_COLOR` env var) |

See [full CLI reference](https://peteretelej.github.io/ai-skills-sync/cli-reference/) for detailed usage.

## Configuration

Skills are managed via a single JSON config file at `~/.config/ai-skills-sync/config.json`. The CLI handles this for you, but you can also edit it directly:

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json",

  "global": [
    { "source": "anthropics/skills", "path": "frontend-design" }
  ],

  "projects": {
    "~/work/api-service": [
      { "source": "supabase/agent-skills" }
    ]
  },

  "conditional": [
    {
      "when": "**/*.tsx",
      "skills": [{ "source": "expo/skills" }]
    }
  ]
}
```

See [configuration docs](https://peteretelej.github.io/ai-skills-sync/configuration/) for the full reference.

## Supported Agents

Skills are synced to all detected agent directories in your project:

| Agent | Directory |
|-------|-----------|
| Agent Skills standard | `.agents/skills/` |
| OpenCode | `.opencode/skills/` |
| Claude Code | `.claude/skills/` |
| GitHub Copilot | `.github/skills/` |
| Cursor | `.cursor/skills/` |

Works with any agent that follows the [Agent Skills](https://agentskills.io) open standard, including Goose, Amp, VS Code, and others.

## How It Works

1. Read your config file
2. Find the project root (nearest `.git`)
3. Resolve applicable skills (global + project-specific + conditional matches)
4. Fetch from GitHub (cached locally) or resolve local paths
5. Copy to all detected agent directories
6. Clean up conditional skills that no longer match
7. Save sync state for fast re-runs

See [how it works](https://peteretelej.github.io/ai-skills-sync/how-it-works/) for the full details.

## Documentation

- [Getting Started](https://peteretelej.github.io/ai-skills-sync/getting-started/)
- [CLI Reference](https://peteretelej.github.io/ai-skills-sync/cli-reference/)
- [Configuration](https://peteretelej.github.io/ai-skills-sync/configuration/)
- [Conditional Skills](https://peteretelej.github.io/ai-skills-sync/conditional-skills/)
- [How It Works](https://peteretelej.github.io/ai-skills-sync/how-it-works/)
- [Comparison with Other Tools](https://peteretelej.github.io/ai-skills-sync/comparison/)
- [FAQ](https://peteretelej.github.io/ai-skills-sync/faq/)

## Requirements

- Node.js >= 22
- Git (for fetching skills from GitHub)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
