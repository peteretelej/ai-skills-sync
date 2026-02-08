// Core interfaces and types

import path from "node:path";

export interface SkillRef {
  source: string;
  path?: string;
}

export interface ParsedSource {
  owner: string;
  repo: string;
  ref?: string;
}

// Sentinel values for local sources
const LOCAL_SOURCE = "local";

export function parseSource(source: string): ParsedSource {
  if (source === LOCAL_SOURCE) {
    return { owner: LOCAL_SOURCE, repo: LOCAL_SOURCE };
  }

  const atIndex = source.indexOf("@");
  let ownerRepo: string;
  let ref: string | undefined;

  if (atIndex !== -1) {
    ownerRepo = source.slice(0, atIndex);
    ref = source.slice(atIndex + 1);
  } else {
    ownerRepo = source;
  }

  const slashIndex = ownerRepo.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid source format: "${source}" - expected "owner/repo[@ref]"`);
  }

  const owner = ownerRepo.slice(0, slashIndex);
  const repo = ownerRepo.slice(slashIndex + 1);

  if (!owner || !repo) {
    throw new Error(`Invalid source format: "${source}" - owner and repo must not be empty`);
  }

  return ref ? { owner, repo, ref } : { owner, repo };
}

export function formatSource(parsed: ParsedSource): string {
  if (parsed.owner === LOCAL_SOURCE && parsed.repo === LOCAL_SOURCE) {
    return LOCAL_SOURCE;
  }
  const base = `${parsed.owner}/${parsed.repo}`;
  return parsed.ref ? `${base}@${parsed.ref}` : base;
}

export function skillRefToRepoUrl(ref: SkillRef): string {
  const parsed = parseSource(ref.source);
  return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

export function deriveSkillName(ref: SkillRef): string {
  if (ref.path) {
    return path.basename(ref.path);
  }
  const parsed = parseSource(ref.source);
  return parsed.repo;
}

export interface Config {
  $schema?: string;
  global?: SkillRef[];
  projects?: Record<string, SkillRef[]>;
  conditional?: ConditionalRule[];
}

export interface ConditionalRule {
  when: string;
  skills: SkillRef[];
}

export interface SyncState {
  version: 1;
  lastSync: string;
  projects: Record<string, ProjectState>;
}

export interface ProjectState {
  skills: Record<string, InstalledSkill>;
  gitignoreSuggested?: boolean;
}

export interface InstalledSkill {
  source: string;
  path?: string;
  commitSha?: string;
  syncedAt: string;
  agents: AgentType[];
  type: SkillType;
}

export type SkillType = "global" | "project" | "conditional";

export interface ResolvedSkill {
  ref: SkillRef;
  type: SkillType;
  installName: string;
}

export type AgentType = "opencode" | "claude" | "copilot" | "cursor" | "agents";

export interface AgentDir {
  type: AgentType;
  skillsPath: string;
}
