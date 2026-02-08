// Core interfaces and types

export interface SkillRef {
  source: string;
  path?: string;
}

export interface ParsedSource {
  owner: string;
  repo: string;
  ref?: string;
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

export type AgentType = "claude" | "copilot" | "cursor";

export interface AgentDir {
  type: AgentType;
  skillsPath: string;
}
