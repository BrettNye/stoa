import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVaultStoaConfig, getCurationConfig } from "./config.js";

describe("loadVaultStoaConfig", () => {
  it("returns full defaults when .stoa/config.json is missing", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-cfg-"));
    const cfg = loadVaultStoaConfig(vault);
    expect(cfg.theme).toBe("pokemon");
    expect(cfg.bind).toBe("127.0.0.1:8443");
    expect(cfg.auth.signing_secret_env).toBe("STOA_TOKEN_SIGNING_SECRET");
    rmSync(vault, { recursive: true, force: true });
  });
  it("merges partial config over defaults", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-cfg-"));
    mkdirSync(join(vault, ".stoa"));
    writeFileSync(join(vault, ".stoa", "config.json"), JSON.stringify({ theme: "plain" }));
    const cfg = loadVaultStoaConfig(vault);
    expect(cfg.theme).toBe("plain");
    expect(cfg.bind).toBe("127.0.0.1:8443");
    rmSync(vault, { recursive: true, force: true });
  });
  it("returns defaults on malformed JSON", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-cfg-"));
    mkdirSync(join(vault, ".stoa"));
    writeFileSync(join(vault, ".stoa", "config.json"), "{ not valid json");
    const cfg = loadVaultStoaConfig(vault);
    expect(cfg.theme).toBe("pokemon");
    rmSync(vault, { recursive: true, force: true });
  });
  it("merges auth fields while keeping defaults for unspecified auth keys", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-cfg-"));
    mkdirSync(join(vault, ".stoa"));
    writeFileSync(
      join(vault, ".stoa", "config.json"),
      JSON.stringify({ auth: { signing_secret_env: "MY_SECRET", issuer_hint: "https://example.com" } }),
    );
    const cfg = loadVaultStoaConfig(vault);
    expect(cfg.auth.signing_secret_env).toBe("MY_SECRET");
    expect(cfg.auth.issuer_hint).toBe("https://example.com");
    expect(cfg.bind).toBe("127.0.0.1:8443");
    rmSync(vault, { recursive: true, force: true });
  });
  it("merges identity fields", () => {
    const vault = mkdtempSync(join(tmpdir(), "stoa-cfg-"));
    mkdirSync(join(vault, ".stoa"));
    writeFileSync(
      join(vault, ".stoa", "config.json"),
      JSON.stringify({ identity: { default_agent_id: "profile-charmander" } }),
    );
    const cfg = loadVaultStoaConfig(vault);
    expect(cfg.identity.default_agent_id).toBe("profile-charmander");
    expect(cfg.theme).toBe("pokemon");
    rmSync(vault, { recursive: true, force: true });
  });
});

describe("getCurationConfig", () => {
  it("returns all defaults when curation block absent", () => {
    expect(getCurationConfig({})).toEqual({
      archive_stale_days: 60,
      promote_active_recent_days: 14,
      confidence_floor: "medium",
      auto_archive_human: false,
      auto_commit: true,
    });
  });

  it("merges partial overrides over defaults", () => {
    expect(
      getCurationConfig({ curation: { archive_stale_days: 30 } }).archive_stale_days,
    ).toBe(30);
  });

  it("keeps other defaults when only one key is overridden", () => {
    const cfg = getCurationConfig({ curation: { archive_stale_days: 30 } });
    expect(cfg.promote_active_recent_days).toBe(14);
    expect(cfg.confidence_floor).toBe("medium");
    expect(cfg.auto_archive_human).toBe(false);
    expect(cfg.auto_commit).toBe(true);
  });

  it("throws ZodError for out-of-range archive_stale_days", () => {
    expect(() =>
      getCurationConfig({ curation: { archive_stale_days: -1 } }),
    ).toThrow();
  });

  it("throws ZodError for zero archive_stale_days", () => {
    expect(() =>
      getCurationConfig({ curation: { archive_stale_days: 0 } }),
    ).toThrow();
  });

  it("throws ZodError for invalid confidence_floor value", () => {
    expect(() =>
      getCurationConfig({ curation: { confidence_floor: "unknown" } }),
    ).toThrow();
  });

  it("accepts all valid confidence_floor values", () => {
    expect(getCurationConfig({ curation: { confidence_floor: "high" } }).confidence_floor).toBe("high");
    expect(getCurationConfig({ curation: { confidence_floor: "medium" } }).confidence_floor).toBe("medium");
    expect(getCurationConfig({ curation: { confidence_floor: "low" } }).confidence_floor).toBe("low");
  });

  it("treats null/non-object rawConfig as empty (returns defaults)", () => {
    expect(getCurationConfig(null)).toEqual({
      archive_stale_days: 60,
      promote_active_recent_days: 14,
      confidence_floor: "medium",
      auto_archive_human: false,
      auto_commit: true,
    });
  });
});
