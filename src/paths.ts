// Cross-platform path utilities

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import envPaths from "env-paths";

const paths = envPaths("ai-skills-sync", { suffix: "" });

export function getConfigDir(): string {
  return paths.config;
}

export function getConfigPath(): string {
  return path.join(paths.config, "config.json");
}

export function getStatePath(): string {
  return path.join(paths.config, "state.json");
}

export function getCacheDir(): string {
  return paths.cache;
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function normalizePath(p: string): string {
  const expanded = expandHome(p);
  const normalized = path.normalize(expanded);
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(normalized);
}

export function getProjectRoot(cwd?: string): string {
  let dir = cwd ? path.resolve(cwd) : process.cwd();

  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root without finding .git
      return cwd ? path.resolve(cwd) : process.cwd();
    }
    dir = parent;
  }
}
