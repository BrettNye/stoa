import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLog } from "../../src/core/log.js";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "vault-log-"));
  mkdirSync(join(vault, "wikis", "alpha"), { recursive: true });
});

describe("appendLog", () => {
  it("creates log.md with header if missing", () => {
    appendLog(vault, "alpha", "synthesize", "agent:claude-code", "rebuilt synthesis-foo");
    const path = join(vault, "wikis", "alpha", "log.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toMatch(/# alpha — operations log/);
    expect(content).toMatch(/synthesize/);
    expect(content).toMatch(/agent:claude-code/);
    expect(content).toMatch(/rebuilt synthesis-foo/);
  });

  it("appends without rewriting existing content", () => {
    appendLog(vault, "alpha", "reindex", "human:brett", "first");
    appendLog(vault, "alpha", "lint", "human:brett", "second");
    const content = readFileSync(join(vault, "wikis", "alpha", "log.md"), "utf8");
    expect(content.match(/first/g)?.length).toBe(1);
    expect(content.match(/second/g)?.length).toBe(1);
  });

  it("entries include ISO timestamp", () => {
    appendLog(vault, "alpha", "inbox", "human:brett", "captured thought");
    const content = readFileSync(join(vault, "wikis", "alpha", "log.md"), "utf8");
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
