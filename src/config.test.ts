import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVaultStoaConfig } from "./config.js";

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
