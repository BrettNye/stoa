import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchPokemon } from "../../src/core/pokeapi.js";

const NETWORK = process.env.VAULT_RUN_NETWORK_TESTS === "1";

describe.skipIf(!NETWORK)("pokeapi — real network (gated)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "vault-pokeapi-net-"));
    mkdirSync(join(vaultPath, "_index"), { recursive: true });
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  it("real network: fetches charmander from PokeAPI", async () => {
    const r = await fetchPokemon(vaultPath, "charmander");
    expect(r.name).toBe("charmander");
    expect(r.types).toContain("fire");
  });
});
