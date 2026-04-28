import { describe, it, expect } from "vitest";
import { parseConfig, ConfigError } from "../../src/config.js";

describe("parseConfig", () => {
  it("returns vault path from --vault flag", () => {
    const cfg = parseConfig(["--vault=/tmp/vault"]);
    expect(cfg.vaultPath).toBe("/tmp/vault");
    expect(cfg.mcpMode).toBe(false);
    expect(cfg.defaultWiki).toBeUndefined();
  });

  it("sets mcpMode when --mcp is present", () => {
    const cfg = parseConfig(["--mcp", "--vault=/tmp/vault"]);
    expect(cfg.mcpMode).toBe(true);
  });

  it("captures --default-wiki", () => {
    const cfg = parseConfig(["--vault=/tmp/vault", "--default-wiki=mylib"]);
    expect(cfg.defaultWiki).toBe("mylib");
  });

  it("falls back to VAULT_PATH env var when --vault is missing", () => {
    const cfg = parseConfig([], { VAULT_PATH: "/env/vault" });
    expect(cfg.vaultPath).toBe("/env/vault");
  });

  it("throws ConfigError when no vault path is found", () => {
    expect(() => parseConfig([], {})).toThrow(ConfigError);
  });
});
