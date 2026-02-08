// State file read/write/diff

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getStatePath } from "./paths.js";
import type {
  SyncState,
  ProjectState,
  InstalledSkill,
  ResolvedSkill,
} from "./types.js";

function emptyState(): SyncState {
  return { version: 1, lastSync: "", projects: {} };
}

function emptyProjectState(): ProjectState {
  return { skills: {} };
}

export function loadState(): SyncState {
  const statePath = getStatePath();
  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    return JSON.parse(raw) as SyncState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState();
    }
    throw err;
  }
}

export async function saveState(state: SyncState): Promise<void> {
  const statePath = getStatePath();
  const dir = path.dirname(statePath);

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify(state, null, 2) + "\n");
}

export function getProjectState(
  state: SyncState,
  projectRoot: string,
): ProjectState {
  return state.projects[projectRoot] ?? emptyProjectState();
}

export function updateProjectState(
  state: SyncState,
  projectRoot: string,
  skills: Record<string, InstalledSkill>,
): SyncState {
  const updated = structuredClone(state);
  updated.projects[projectRoot] = { skills };
  return updated;
}

export function isInSync(
  state: SyncState,
  projectRoot: string,
  resolvedSkills: ResolvedSkill[],
): boolean {
  const projectState = getProjectState(state, projectRoot);
  const installed = projectState.skills;

  const installedNames = new Set(Object.keys(installed));
  const resolvedNames = new Set(resolvedSkills.map((s) => s.installName));

  // Different number of skills means out of sync
  if (installedNames.size !== resolvedNames.size) return false;

  // Every resolved skill must exist in state with matching source and path
  for (const skill of resolvedSkills) {
    const entry = installed[skill.installName];
    if (!entry) return false;
    if (entry.source !== skill.ref.source) return false;
    if ((entry.path ?? undefined) !== (skill.ref.path ?? undefined))
      return false;
  }

  return true;
}

export function getOrphanedSkills(
  state: SyncState,
  projectRoot: string,
  resolvedSkills: ResolvedSkill[],
): string[] {
  const projectState = getProjectState(state, projectRoot);
  const resolvedNames = new Set(resolvedSkills.map((s) => s.installName));

  return Object.keys(projectState.skills).filter(
    (name) => !resolvedNames.has(name),
  );
}

export function getManagedSkillNames(
  state: SyncState,
  projectRoot: string,
): string[] {
  const projectState = getProjectState(state, projectRoot);
  return Object.keys(projectState.skills);
}
