import { describe, it, expect } from "vitest";
import {
  ConfigError,
  FetchError,
  SyncError,
  SkillNotFoundError,
} from "../src/errors.js";

describe("ConfigError", () => {
  it("has userMessage", () => {
    const err = new ConfigError("bad json");
    expect(err.userMessage).toBe("Config error: bad json");
    expect(err.message).toBe("bad json");
    expect(err.name).toBe("ConfigError");
  });

  it("includes line and column when provided", () => {
    const err = new ConfigError("unexpected token", { line: 5, column: 12 });
    expect(err.line).toBe(5);
    expect(err.column).toBe(12);
    expect(err.userMessage).toBe(
      "Config error at line 5, column 12: unexpected token"
    );
  });

  it("is an instance of Error", () => {
    expect(new ConfigError("test")).toBeInstanceOf(Error);
  });
});

describe("FetchError", () => {
  it("has userMessage", () => {
    const err = new FetchError("timeout after 60s");
    expect(err.userMessage).toBe("Fetch failed: timeout after 60s");
    expect(err.name).toBe("FetchError");
  });
});

describe("SyncError", () => {
  it("has userMessage", () => {
    const err = new SyncError("permission denied");
    expect(err.userMessage).toBe("Sync failed: permission denied");
    expect(err.name).toBe("SyncError");
  });
});

describe("SkillNotFoundError", () => {
  it("has userMessage with suggestion", () => {
    const err = new SkillNotFoundError("obra/tdd");
    expect(err.userMessage).toContain("obra/tdd");
    expect(err.userMessage).toContain("check the repo exists");
    expect(err.name).toBe("SkillNotFoundError");
  });
});
