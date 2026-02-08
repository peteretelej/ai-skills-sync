// File glob scanning for conditionals

import fsp from "node:fs/promises";
import type { ConditionalRule } from "./types.js";

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "vendor",
  "__pycache__",
  ".venv",
  "target",
  "coverage",
  ".next",
  ".nuxt",
];

export async function scanForConditionalMatches(
  projectRoot: string,
  rules: ConditionalRule[],
): Promise<ConditionalRule[]> {
  const matched: ConditionalRule[] = [];

  for (const rule of rules) {
    const iter = fsp.glob(rule.when, {
      cwd: projectRoot,
      exclude: (p) => EXCLUDED_DIRS.includes(p),
    });

    for await (const _ of iter) {
      matched.push(rule);
      break; // early exit: one match is enough
    }
  }

  return matched;
}
