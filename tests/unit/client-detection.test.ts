import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClients } from "../../src/core/client-detection.js";

it("detects claude-code when ~/.claude/ exists", () => {
  const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
  mkdirSync(join(home, ".claude"));
  const found = detectClients(home, process.platform);
  expect(found.map((c) => c.client)).toContain("claude-code");
});

it("returns empty array when no client directories exist", () => {
  const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
  // Don't create any client directories
  const found = detectClients(home, process.platform);
  expect(found).toEqual([]);
});

it("detects cursor when ~/.cursor/ exists", () => {
  const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
  mkdirSync(join(home, ".cursor"));
  const found = detectClients(home, process.platform);
  expect(found.map((c) => c.client)).toContain("cursor");
  expect(found.map((c) => c.client)).not.toContain("claude-code");
});

it("detects codex when ~/.config/codex/ exists", () => {
  const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
  mkdirSync(join(home, ".config", "codex"), { recursive: true });
  const found = detectClients(home, process.platform);
  expect(found.map((c) => c.client)).toContain("codex");
});

it("detects multiple clients when multiple config dirs exist", () => {
  const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
  mkdirSync(join(home, ".claude"));
  mkdirSync(join(home, ".cursor"));
  mkdirSync(join(home, ".config", "codex"), { recursive: true });
  const found = detectClients(home, process.platform);
  const names = found.map((c) => c.client);
  expect(names).toContain("claude-code");
  expect(names).toContain("cursor");
  expect(names).toContain("codex");
  expect(found).toHaveLength(3);
});

describe("client path conventions", () => {
  it("claude-code uses correct settings_path and user_md_path", () => {
    const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
    mkdirSync(join(home, ".claude"));
    const found = detectClients(home, process.platform);
    const client = found.find((c) => c.client === "claude-code")!;
    expect(client.config_dir).toBe(join(home, ".claude"));
    expect(client.settings_path).toBe(join(home, ".claude", "settings.json"));
    expect(client.user_md_path).toBe(join(home, ".claude", "CLAUDE.md"));
  });

  it("cursor uses correct settings_path and user_md_path", () => {
    const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
    mkdirSync(join(home, ".cursor"));
    const found = detectClients(home, process.platform);
    const client = found.find((c) => c.client === "cursor")!;
    expect(client.config_dir).toBe(join(home, ".cursor"));
    expect(client.settings_path).toBe(join(home, ".cursor", "mcp.json"));
    expect(client.user_md_path).toBe(join(home, ".cursor", "rules", "stoa.mdc"));
  });

  it("codex uses correct settings_path and user_md_path", () => {
    const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
    mkdirSync(join(home, ".config", "codex"), { recursive: true });
    const found = detectClients(home, process.platform);
    const client = found.find((c) => c.client === "codex")!;
    expect(client.config_dir).toBe(join(home, ".config", "codex"));
    expect(client.settings_path).toBe(join(home, ".config", "codex", "config.json"));
    expect(client.user_md_path).toBe(join(home, ".config", "codex", "CODEX.md"));
  });

  it("does not require settings.json to exist - only config_dir existence matters", () => {
    const home = mkdtempSync(join(tmpdir(), "stoa-onboard-"));
    // Create only config_dir, not settings.json or user_md_path
    mkdirSync(join(home, ".claude"));
    const found = detectClients(home, process.platform);
    // Should still detect the client even though settings.json doesn't exist
    expect(found.map((c) => c.client)).toContain("claude-code");
    expect(found).toHaveLength(1);
  });
});
