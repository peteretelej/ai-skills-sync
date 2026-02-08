# Contributing to ai-skills-sync

Thanks for your interest in contributing! This guide will help you get set up.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [Git](https://git-scm.com/)

## Setup

```bash
git clone https://github.com/peteretelej/ai-skills-sync.git
cd ai-skills-sync
npm install
```

## Development

```bash
# Run in watch mode (recompiles on change)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type check without emitting
npm run typecheck
```

## Project Structure

```
src/
  cli.ts        CLI entry point and command definitions
  types.ts      Core interfaces (SkillRef, Config, SyncState, etc.)
  config.ts     Config file read/write/setup
  resolver.ts   Skill resolution and deduplication
  syncer.ts     Sync orchestrator (fetch, copy, orphan handling)
  fetcher.ts    Git clone and cache management
  agents.ts     Agent directory detection (.claude/, .github/, .cursor/)
  scanner.ts    File glob scanning for conditional skills
  paths.ts      Cross-platform path utilities
  state.ts      Sync state persistence
  errors.ts     Custom error types
  logger.ts     Colored console output

test/
  *.test.ts     Test files mirroring src/ structure
```

## Running Tests

Tests use [Vitest](https://vitest.dev/):

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run test/resolver.test.ts

# Run tests in watch mode
npx vitest
```

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test` and `npm run typecheck` to verify
4. Submit a PR with a clear description of what changed and why

## Reporting Issues

Found a bug or have a feature request? [Open an issue](https://github.com/peteretelej/ai-skills-sync/issues).
