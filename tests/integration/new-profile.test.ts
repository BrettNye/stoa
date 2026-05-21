import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newProfileTool } from "../../src/tools/new-profile.js";
import { parseFrontmatter } from "../../src/core/frontmatter.js";
import { loadIndex } from "../../src/core/index.js";
import { reindex } from "../../src/core/reindex.js";

const fireTypeResponse = {
  pokemon: [
    { pokemon: { name: "vulpix",     url: "https://pokeapi.co/api/v2/pokemon/37/" } },
    { pokemon: { name: "growlithe",  url: "https://pokeapi.co/api/v2/pokemon/58/" } }
  ]
};

function makeFireFetcher(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/type/fire")) return new Response(JSON.stringify(fireTypeResponse), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("vault_new-profile (integration)", () => {
  let vault: string;

  beforeEach(async () => {
    vault = mkdtempSync(join(tmpdir(), "vault-newprofile-int-"));
    mkdirSync(join(vault, "wikis", "_agents", "profiles"), { recursive: true });
    mkdirSync(join(vault, "_index"), { recursive: true });
    writeFileSync(join(vault, "_index", "aliases.json"), "{}");
    await reindex(vault);
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("writes a profile file with the v1.5 required frontmatter fields", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon: "vulpix",
        pokemon_type: "fire"
      },
      { vaultPath: vault }
    );
    const raw = readFileSync(r.path, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);

    // Vault-canonical fields
    expect(frontmatter.id).toBe("profile-vulpix");
    expect(frontmatter.type).toBe("profile");
    expect(frontmatter.wiki).toBe("_agents");
    expect(frontmatter.title).toBe("Backend Agent");
    expect(frontmatter.status).toBe("draft");

    // v1.5 substrate required fields
    expect(frontmatter.pokemon_type).toBe("fire");
    expect(frontmatter.evolution_stage).toBe("basic");
    expect(frontmatter.moveset).toEqual([]);
    expect(frontmatter.autonomy_level).toBe("restricted");
    expect(frontmatter.applies_to).toEqual(["claude-code"]);

    // Body has a meaningful skeleton
    expect(body).toContain("Backend Agent");
  });

  it("makes the new profile immediately visible via loadIndex (write-through)", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon: "vulpix",
        pokemon_type: "fire"
      },
      { vaultPath: vault }
    );
    const idx = loadIndex(vault);
    expect(idx.pages.some(p => p.id === r.id && p.type === "profile")).toBe(true);
  });

  it("rolls a pokemon name via PokeAPI when none given", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Backend Agent",
        wiki: "_agents",
        pokemon_type: "fire"
      },
      { vaultPath: vault, fetcher: makeFireFetcher() }
    );
    const raw = readFileSync(r.path, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.pokemon_type).toBe("fire");
    expect(["vulpix", "growlithe"]).toContain(r.pokemon);
    expect(r.id).toBe(`profile-${r.pokemon}`);
  });

  it("writes to wikis/<wiki>/profiles/<id>.md", async () => {
    const r = await newProfileTool.handler(
      {
        title: "Agent A",
        wiki: "_agents",
        pokemon: "growlithe",
        pokemon_type: "fire"
      },
      { vaultPath: vault }
    );
    expect(r.path.replace(/\\/g, "/")).toContain("wikis/_agents/profiles/profile-growlithe.md");
  });
});
