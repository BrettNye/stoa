import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const SCRIPT = join(process.cwd(), "scripts", "statusline-pokemon.sh");

const HAS_BASH = (() => {
  try { execSync("bash --version", { stdio: "pipe" }); return true; }
  catch { return false; }
})();

describe.skipIf(!HAS_BASH)("statusline-pokemon.sh", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-statusline-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
    writeFileSync(join(vaultPath, "_index", "profiles.json"), JSON.stringify({
      "profile-charmander": {
        id: "profile-charmander",
        pokemon_type: "fire",
        evolution_stage: "basic",
        moveset: [],
        tasks_completed: 5,
        tasks_failed: 0,
        tasks_in_flight: 1,
        journals_count: 3,
        channels_active: ["feat-x"],
        moves_used_freq: {},
        days_since_creation: 1
      }
    }, null, 2));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("emits a statusline for an explicit pokemon", () => {
    const out = execSync(`bash "${SCRIPT}"`, {
      env: { ...process.env, STOA_VAULT_PATH: vaultPath, VAULT_POKEMON: "profile-charmander" },
      encoding: "utf8"
    }).trim();
    expect(out).toMatch(/Charmander/);
    expect(out).toMatch(/🔥/);
    expect(out).toMatch(/1 task/);
  });

  it("falls back to first profile when VAULT_POKEMON unset", () => {
    const out = execSync(`bash "${SCRIPT}"`, {
      env: { ...process.env, STOA_VAULT_PATH: vaultPath },
      encoding: "utf8"
    }).trim();
    expect(out).toMatch(/Charmander/);
  });

  it("prints error and exits 0 when STOA_VAULT_PATH is unset", () => {
    const env = { ...process.env };
    delete (env as Record<string, string | undefined>).STOA_VAULT_PATH;
    delete (env as Record<string, string | undefined>).VAULT_PATH;
    const out = execSync(`bash "${SCRIPT}"`, {
      env,
      encoding: "utf8"
    }).trim();
    expect(out).toBe("🛑 STOA_VAULT_PATH unset");
  });
});
