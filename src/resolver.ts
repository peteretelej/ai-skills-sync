// Determine applicable skills for cwd

import type { Config, ResolvedSkill, SkillRef, SkillType } from "./types.js";
import { deriveSkillName, parseSource } from "./types.js";
import { normalizePath } from "./paths.js";
import { scanForConditionalMatches } from "./scanner.js";

interface TaggedSkill {
  ref: SkillRef;
  type: SkillType;
}

/**
 * Main entry point: resolve which skills apply to a project.
 * Collects global, project-specific, and conditional skills,
 * deduplicates, and resolves install names with collision handling.
 */
export async function resolveSkills(
  config: Config,
  projectRoot: string,
): Promise<ResolvedSkill[]> {
  const tagged: TaggedSkill[] = [];

  // 1. Global skills
  const globalSkills = config.global ?? [];
  for (const ref of globalSkills) {
    tagged.push({ ref, type: "global" });
  }

  // 2. Project-specific skills
  const projects = config.projects ?? {};
  const normalizedRoot = normalizePath(projectRoot);
  for (const [projectKey, skills] of Object.entries(projects)) {
    if (normalizePath(projectKey) === normalizedRoot) {
      for (const ref of skills) {
        tagged.push({ ref, type: "project" });
      }
    }
  }

  // 3. Conditional skills
  const conditionalRules = config.conditional ?? [];
  if (conditionalRules.length > 0) {
    const matchedRules = await scanForConditionalMatches(
      projectRoot,
      conditionalRules,
    );
    for (const rule of matchedRules) {
      for (const ref of rule.skills) {
        tagged.push({ ref, type: "conditional" });
      }
    }
  }

  // 4. Deduplicate
  const deduped = deduplicateSkills(tagged);

  // 5. Resolve install names
  return resolveInstallNames(deduped);
}

/**
 * Remove duplicate skill refs (same source + path).
 * Priority: project > global > conditional.
 * When a skill appears in multiple sections, the higher-priority entry wins.
 */
export function deduplicateSkills(skills: TaggedSkill[]): TaggedSkill[] {
  const seen = new Map<string, TaggedSkill>();

  for (const skill of skills) {
    const key = skillKey(skill.ref);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, skill);
      continue;
    }

    // Higher priority wins: project > global > conditional
    if (typePriority(skill.type) > typePriority(existing.type)) {
      seen.set(key, skill);
    }
  }

  return [...seen.values()];
}

/**
 * Derive install directory names and handle collisions.
 * Single-use names stay as-is (e.g. "tdd").
 * Collisions get dot-prefixed with owner (e.g. "obra.tdd", "acme.tdd").
 */
export function resolveInstallNames(skills: TaggedSkill[]): ResolvedSkill[] {
  // Derive base names
  const withNames = skills.map((s) => ({
    ...s,
    baseName: deriveSkillName(s.ref),
  }));

  // Group by base name
  const groups = new Map<string, typeof withNames>();
  for (const entry of withNames) {
    const group = groups.get(entry.baseName) ?? [];
    group.push(entry);
    groups.set(entry.baseName, group);
  }

  const resolved: ResolvedSkill[] = [];
  for (const [baseName, group] of groups) {
    if (group.length === 1) {
      // No collision: use base name as-is
      resolved.push({
        ref: group[0].ref,
        type: group[0].type,
        installName: baseName,
      });
    } else {
      // Collision: prefix with owner.name
      for (const entry of group) {
        const parsed = parseSource(entry.ref.source);
        const prefixed = `${parsed.owner}.${baseName}`;
        resolved.push({
          ref: entry.ref,
          type: entry.type,
          installName: prefixed,
        });
      }
    }
  }

  return resolved;
}

function skillKey(ref: SkillRef): string {
  return `${ref.source}::${ref.path ?? ""}`;
}

function typePriority(type: SkillType): number {
  switch (type) {
    case "project":
      return 2;
    case "global":
      return 1;
    case "conditional":
      return 0;
  }
}
