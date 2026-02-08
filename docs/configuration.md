---
title: Configuration
description: Config file format, skill references, and all three configuration modes
---

# Configuration

`ai-skills-sync` uses a single JSON config file to declare which skills belong where. Most users won't need to edit this file directly since the CLI handles it, but understanding the format helps with advanced setups.

## Config File Location

| Platform | Path |
|----------|------|
| macOS / Linux | `~/.config/ai-skills-sync/config.json` |
| Windows | `%APPDATA%\ai-skills-sync\config.json` |

The path respects `XDG_CONFIG_HOME` on Linux. Run `npx ai-skills-sync config` to see the exact location on your system.

## Full Example

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json",

  // Skills synced to every project
  "global": [
    { "source": "anthropics/skills", "path": "frontend-design" },
    { "source": "anthropics/skills", "path": "skill-creator" }
  ],

  // Skills for specific projects only
  "projects": {
    "~/work/platform-services": [
      { "source": "supabase/agent-skills" },
      { "source": "getsentry/skills" }
    ],
    "~/projects/acme-dashboard": [
      { "source": "vercel-labs/agent-skills", "path": "vercel-react-best-practices" }
    ]
  },

  // Skills auto-activated when matching files exist
  "conditional": [
    {
      "when": "**/*.tsx",
      "skills": [{ "source": "expo/skills" }]
    },
    {
      "when": "workers.ts",
      "skills": [{ "source": "cloudflare/skills" }]
    }
  ]
}
```

## The Three Modes

### Global Skills

Skills listed under `global` are synced to every project you run `ai-skills-sync` in. Use this for universally useful skills like TDD methodology or debugging patterns.

```json
{
  "global": [
    { "source": "anthropics/skills", "path": "frontend-design" }
  ]
}
```

**CLI equivalent:** `npx ai-skills-sync add anthropics/skills --skill frontend-design`

### Project-Specific Skills

Skills under `projects` are keyed by the project's root directory path. They only sync when you run `ai-skills-sync` from that specific project. Paths support `~` for the home directory.

```json
{
  "projects": {
    "~/work/platform-services": [
      { "source": "supabase/agent-skills" }
    ]
  }
}
```

**CLI equivalent:** `npx ai-skills-sync add supabase/agent-skills --project` (run from the project directory)

### Conditional Skills

Conditional rules activate skills based on file patterns in the project. When the glob pattern matches at least one file, the associated skills are synced. When it no longer matches, they're automatically removed.

```json
{
  "conditional": [
    {
      "when": "**/*.tsx",
      "skills": [{ "source": "expo/skills" }]
    }
  ]
}
```

**CLI equivalent:** `npx ai-skills-sync add expo/skills --when "**/*.tsx"`

See [Conditional Skills](./conditional-skills.md) for more details.

## Skill Reference Format

Each skill is referenced by a `source` and an optional `path`:

| Example | Meaning |
|---------|---------|
| `{ "source": "supabase/agent-skills" }` | Root skill from a GitHub repo, latest version |
| `{ "source": "supabase/agent-skills@v1.2" }` | Pinned to a git tag, branch, or commit |
| `{ "source": "anthropics/skills", "path": "frontend-design" }` | Specific subdirectory in a monorepo |
| `{ "source": "local", "path": "~/my-skills/custom" }` | Local filesystem skill |

### Version Pinning

Append `@ref` to pin a skill to a specific git tag, branch, or commit:

```json
{ "source": "anthropics/skills@v1.2" }
{ "source": "anthropics/skills@main" }
{ "source": "anthropics/skills@abc1234" }
```

Without a ref, the latest default branch is used.

### Monorepo Skills

Some skill repositories contain multiple skills in subdirectories. Use the `path` field to specify which one:

```json
{ "source": "anthropics/skills", "path": "frontend-design" }
```

Or use the CLI's `--skill` flag to discover skills by name:

```bash
npx ai-skills-sync add anthropics/skills --skill frontend-design
```

### Local Skills

For skills on your local filesystem (not in a git repo), use `"source": "local"` with a `path`:

```json
{ "source": "local", "path": "~/my-skills/custom-linter" }
```

Local skills are copied directly without caching. Paths support `~` and can be absolute or relative.

## JSON Schema

The config file supports a `$schema` field for editor validation and autocomplete:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/ai-skills-sync@latest/schema.json"
}
```

This gives you inline validation in VS Code and other editors that support JSON Schema.

## Resolution Priority

When the same skill appears in multiple sections, the higher-priority entry wins:

1. **Project-specific** (highest)
2. **Global**
3. **Conditional** (lowest)

This means if a skill is both global and project-specific, the project-specific entry takes precedence.

## Namespace Collisions

If two different sources provide a skill with the same directory name (e.g., both `anthropics/skills` and `acme/skills` each have a `frontend-design` skill), the install directories are prefixed with the owner using dot notation:

- `anthropics.frontend-design/`
- `acme.frontend-design/`

When only one skill has a given name, it installs without a prefix.
