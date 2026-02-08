---
title: Conditional Skills
description: Auto-activate skills based on files in your project
---

# Conditional Skills

Conditional skills are the most powerful feature of `ai-skills-sync`. They automatically activate skills based on what files exist in a project, and automatically clean up when those files are removed.

## How It Works

A conditional rule pairs a glob pattern with one or more skills:

```json
{
  "when": "**/*.tsx",
  "skills": [{ "source": "expo/skills" }]
}
```

When you run `npx ai-skills-sync`:

1. The tool scans the project for files matching `**/*.tsx`
2. If at least one match is found, the associated skills are synced
3. If no matches are found, the skills are automatically removed from the project

This means your AI agent always has the right context for the codebase in front of it, without any manual management.

## Adding Conditional Skills

Via CLI:

```bash
npx ai-skills-sync add expo/skills --when "**/*.tsx"
```

Or by editing the config directly:

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

## Practical Examples

### By Language/Framework

```json
{
  "conditional": [
    {
      "when": "**/*.tsx",
      "skills": [{ "source": "expo/skills" }]
    },
    {
      "when": "**/*.py",
      "skills": [{ "source": "supabase/agent-skills" }]
    },
    {
      "when": "**/*.rs",
      "skills": [{ "source": "anthropics/skills", "path": "skill-creator" }]
    }
  ]
}
```

### By Infrastructure/Config Files

```json
{
  "conditional": [
    {
      "when": "workers.ts",
      "skills": [{ "source": "cloudflare/skills" }]
    },
    {
      "when": "docker-compose*.yml",
      "skills": [{ "source": "anthropics/skills", "path": "frontend-design" }]
    },
    {
      "when": "**/*.prisma",
      "skills": [{ "source": "supabase/agent-skills" }]
    }
  ]
}
```

### Multiple Skills per Pattern

A single glob pattern can trigger multiple skills:

```json
{
  "when": "**/*.tsx",
  "skills": [
    { "source": "expo/skills" },
    { "source": "vercel-labs/agent-skills", "path": "vercel-react-best-practices" }
  ]
}
```

## Glob Pattern Syntax

Patterns follow standard glob syntax:

| Pattern | Matches |
|---------|---------|
| `**/*.tsx` | Any `.tsx` file in any subdirectory |
| `*.tf` | `.tf` files in the project root |
| `src/**/*.test.ts` | Test files under `src/` |
| `docker-compose*.yml` | `docker-compose.yml`, `docker-compose.dev.yml`, etc. |
| `**/*.prisma` | Prisma schema files anywhere |

The scanner automatically excludes common build/dependency directories: `node_modules`, `.git`, `dist`, `build`, `vendor`, `__pycache__`, `.venv`, `target`, `coverage`, `.next`, `.nuxt`.

## Automatic Cleanup

This is what makes conditional skills different from global and project-specific skills. When a conditional skill's glob pattern no longer matches any files in the project, the skill is automatically removed from the project's agent directories on the next sync.

For example:
1. You have a conditional rule for `**/*.tsx`
2. You run `npx ai-skills-sync` in a React project, and the React skills are synced
3. You later convert the project from React to Svelte, removing all `.tsx` files
4. Next time you run `npx ai-skills-sync`, the React skills are automatically removed

Global and project-specific skills are never auto-removed. If they become orphaned (removed from config but still in the project), the tool suggests cleanup instead.

## Priority

Conditional skills have the lowest resolution priority. If the same skill is also declared as global or project-specific, the higher-priority entry takes precedence:

1. **Project-specific** (highest)
2. **Global**
3. **Conditional** (lowest)

This means you can override a conditional skill with a project-specific entry if needed.
