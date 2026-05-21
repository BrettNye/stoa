import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runNonInteractive, registerInit } from "../../src/cli/commands/init.js";

describe("stoa init -y (non-interactive mode)", () => {
  let vault: string;
  let origEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "stoa-init-y-"));
    origEnv = {
      STOA_VAULT_PATH: process.env.STOA_VAULT_PATH,
      STOA_THEME: process.env.STOA_THEME,
      STOA_DEFAULT_WIKI: process.env.STOA_DEFAULT_WIKI,
    };
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
    // Restore env
    for (const key of ["STOA_VAULT_PATH", "STOA_THEME", "STOA_DEFAULT_WIKI"] as const) {
      if (origEnv[key] !== undefined) {
        process.env[key] = origEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("runNonInteractive uses STOA_VAULT_PATH from env", async () => {
    process.env.STOA_VAULT_PATH = vault;
    delete process.env.STOA_THEME;
    delete process.env.STOA_DEFAULT_WIKI;

    const result = await runNonInteractive();

    expect(result.vaultPath).toBe(vault);
    expect(existsSync(join(vault, "_index", "pages.json"))).toBe(true);
    expect(existsSync(join(vault, "wikis", "_agents"))).toBe(true);
  });

  it("runNonInteractive uses STOA_THEME from env", async () => {
    process.env.STOA_VAULT_PATH = vault;
    process.env.STOA_THEME = "plain";
    delete process.env.STOA_DEFAULT_WIKI;

    const result = await runNonInteractive();

    expect(result.theme).toBe("plain");
    expect(existsSync(join(vault, "_index", "pages.json"))).toBe(true);
  });

  it("runNonInteractive uses STOA_DEFAULT_WIKI from env and sets active wiki", async () => {
    process.env.STOA_VAULT_PATH = vault;
    delete process.env.STOA_THEME;
    process.env.STOA_DEFAULT_WIKI = "myproject";

    const result = await runNonInteractive();

    expect(result.activeWiki).toBe("myproject");
    expect(existsSync(join(vault, "wikis", "myproject"))).toBe(true);
    const active = readFileSync(join(vault, ".active-wiki"), "utf8").trim();
    expect(active).toBe("myproject");
  });

  it("runNonInteractive falls back to 'pokemon' theme when STOA_THEME is not set", async () => {
    process.env.STOA_VAULT_PATH = vault;
    delete process.env.STOA_THEME;
    delete process.env.STOA_DEFAULT_WIKI;

    const result = await runNonInteractive();

    expect(result.theme).toBe("pokemon");
  });

  it("runNonInteractive is idempotent: re-run on existing vault succeeds", async () => {
    process.env.STOA_VAULT_PATH = vault;
    delete process.env.STOA_THEME;
    delete process.env.STOA_DEFAULT_WIKI;

    // First run
    await runNonInteractive();
    expect(existsSync(join(vault, "_index", "pages.json"))).toBe(true);

    // Second run should not throw
    const result2 = await runNonInteractive();
    expect(result2.vaultPath).toBe(vault);
    expect(existsSync(join(vault, "_index", "pages.json"))).toBe(true);
  });

  it("registerInit command wiring includes -y / --yes option", async () => {
    const { Command } = await import("commander");
    const program = new Command();
    registerInit(program);

    const initCmd = program.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();

    const options = initCmd!.options;
    const yesOpt = options.find((o) => o.short === "-y" || o.long === "--yes");
    expect(yesOpt).toBeDefined();
  });
});
