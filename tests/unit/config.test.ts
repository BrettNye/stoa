import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseConfig, ConfigError } from "../../src/config.js";

describe("parseConfig", () => {
  it("returns vault path from --vault flag", () => {
    const cfg = parseConfig(["--vault=/tmp/vault"]);
    expect(cfg.vaultPath).toBe(resolve("/tmp/vault"));
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

  it("captures --default-family", () => {
    const cfg = parseConfig(["--vault=/tmp/vault", "--default-family=rastate"]);
    expect(cfg.defaultFamily).toBe("rastate");
    expect(cfg.defaultWiki).toBeUndefined();
  });

  it("captures both --default-wiki and --default-family independently", () => {
    const cfg = parseConfig([
      "--vault=/tmp/vault",
      "--default-wiki=rastate-core",
      "--default-family=rastate"
    ]);
    expect(cfg.defaultWiki).toBe("rastate-core");
    expect(cfg.defaultFamily).toBe("rastate");
  });

  it("leaves defaultFamily undefined when --default-family is absent", () => {
    const cfg = parseConfig(["--vault=/tmp/vault"]);
    expect(cfg.defaultFamily).toBeUndefined();
  });

  it("falls back to STOA_VAULT_PATH env var when --vault is missing", () => {
    const cfg = parseConfig([], { STOA_VAULT_PATH: "/env/vault" });
    expect(cfg.vaultPath).toBe(resolve("/env/vault"));
  });

  it("reads STOA_VAULT_PATH from env", () => {
    const cfg = parseConfig([], { STOA_VAULT_PATH: "/tmp/v" });
    expect(cfg.vaultPath).toBe(resolve("/tmp/v"));
  });

  it("ignores legacy VAULT_PATH (not read)", () => {
    expect(() =>
      parseConfig([], { VAULT_PATH: "/tmp/v" })
    ).toThrow(/STOA_VAULT_PATH/);
  });

  it("throws ConfigError when no vault path is found", () => {
    expect(() => parseConfig([], {})).toThrow(ConfigError);
  });

  it("resolves relative --vault path to absolute", () => {
    const cfg = parseConfig(["--vault=."]);
    // path.resolve(".") returns the current working directory as absolute
    expect(cfg.vaultPath).not.toBe(".");
    // Sanity: it should be absolute (Windows: drive letter; Unix: starts with /)
    const isAbsolute = /^([A-Za-z]:[\\/]|\/)/.test(cfg.vaultPath);
    expect(isAbsolute).toBe(true);
  });

  it("resolves relative STOA_VAULT_PATH env var to absolute", () => {
    const cfg = parseConfig([], { STOA_VAULT_PATH: "./relative/sub" });
    expect(cfg.vaultPath).not.toBe("./relative/sub");
    const isAbsolute = /^([A-Za-z]:[\\/]|\/)/.test(cfg.vaultPath);
    expect(isAbsolute).toBe(true);
  });
});
