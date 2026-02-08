// Error types and formatting

export class ConfigError extends Error {
  userMessage: string;
  line?: number;
  column?: number;

  constructor(message: string, options?: { line?: number; column?: number }) {
    super(message);
    this.name = "ConfigError";
    this.line = options?.line;
    this.column = options?.column;
    this.userMessage = options?.line
      ? `Config error at line ${options.line}, column ${options.column}: ${message}`
      : `Config error: ${message}`;
  }
}

export class FetchError extends Error {
  userMessage: string;

  constructor(message: string) {
    super(message);
    this.name = "FetchError";
    this.userMessage = `Fetch failed: ${message}`;
  }
}

export class SyncError extends Error {
  userMessage: string;

  constructor(message: string) {
    super(message);
    this.name = "SyncError";
    this.userMessage = `Sync failed: ${message}`;
  }
}

export class SkillNotFoundError extends Error {
  userMessage: string;

  constructor(source: string) {
    super(`Skill not found: ${source}`);
    this.name = "SkillNotFoundError";
    this.userMessage = `Could not find "${source}" - check the repo exists and is public, or verify git SSH access.`;
  }
}
