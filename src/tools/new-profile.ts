// vault-mcp/src/tools/new-profile.ts
//
// Thin wrapper around the underlying writePage primitive that pre-fills the
// v1.5 substrate frontmatter required for `type: profile`. Use this instead
// of vault_new when creating profiles so first-time users don't have to
// memorize the substrate field set (pokemon_type, evolution_stage, moveset,
// autonomy_level, applies_to). When a pokemon name isn't supplied, rolls
// one via PokeAPI keyed by pokemon_type or dev_specialty.
//
// See wikis/_agents/CLAUDE.md for the substrate field contract.
import { z } from "zod";
import { writePage } from "../core/pages.js";
import { upsertPage } from "../core/index.js";
import { suggestByType } from "../core/pokeapi.js";
import { mapDevSpecialty, isValidPokemonType } from "../core/pokemon.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  title: z.string().min(1),
  wiki: z.string().optional(),
  pokemon_type: z.string().optional(),
  dev_specialty: z.string().optional(),
  pokemon: z.string().optional(),
  evolution_stage: z.enum(["basic", "stage1", "stage2"]).default("basic"),
  autonomy_level: z.enum(["restricted", "feature-branch", "main-branch"]).default("restricted"),
  moveset: z.array(z.string()).default([]),
  applies_to: z.array(z.string()).default(["claude-code"])
});

export const newProfileTool = {
  name: "vault_new-profile",
  description: "Scaffold a new agent profile with v1.5 substrate frontmatter pre-filled. Rolls a Pokemon name from pokemon_type or dev_specialty if not given. Use this instead of vault_new when creating profiles.",
  inputSchema: Input,
  handler: async (
    input: unknown,
    ctx: { vaultPath: string; defaultWiki?: string; fetcher?: typeof fetch }
  ) => {
    const parsed = Input.parse(input);
    const wiki = resolveWiki(parsed.wiki, ctx.defaultWiki, ctx.vaultPath);

    // Resolve pokemon_type from dev_specialty if not explicit.
    let pokemonType = parsed.pokemon_type;
    if (!pokemonType && parsed.dev_specialty) {
      pokemonType = mapDevSpecialty(parsed.dev_specialty);
    }

    // If a pokemon name wasn't supplied, we need a type to roll one.
    let pokemon = parsed.pokemon?.trim().toLowerCase();
    if (!pokemon) {
      if (!pokemonType) {
        throw new Error("either pokemon, pokemon_type, or dev_specialty is required");
      }
      if (!isValidPokemonType(pokemonType)) {
        throw new Error(`invalid pokemon_type: ${pokemonType}`);
      }
      const suggestions = await suggestByType(ctx.vaultPath, pokemonType, { fetcher: ctx.fetcher });
      if (suggestions.length === 0) {
        throw new Error(`no PokeAPI candidates returned for type=${pokemonType}; pass an explicit pokemon`);
      }
      pokemon = suggestions[0].name.toLowerCase();
    }

    // Final pokemonType fallback — if the caller passed an explicit pokemon
    // without a type, we leave pokemon_type empty rather than guessing,
    // because the v1.5 substrate treats this as a required, intent-bearing
    // field. Surface a clear error instead.
    if (!pokemonType) {
      throw new Error("pokemon_type or dev_specialty is required when pokemon is supplied without one");
    }
    if (!isValidPokemonType(pokemonType)) {
      throw new Error(`invalid pokemon_type: ${pokemonType}`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const id = `profile-${pokemon}`;

    const frontmatter: Record<string, any> = {
      id,
      title: parsed.title,
      type: "profile",
      wiki,
      created: today,
      status: "draft",
      pokemon_type: pokemonType,
      evolution_stage: parsed.evolution_stage,
      autonomy_level: parsed.autonomy_level,
      moveset: parsed.moveset,
      applies_to: parsed.applies_to
    };

    const body = `# ${parsed.title}\n\n## Role\n\nTODO: describe what this agent specializes in.\n\n## Moveset\n\nTODO: list the moves this profile pulls into its deploy.\n`;

    const result = writePage(ctx.vaultPath, {
      id, type: "profile", wiki,
      frontmatter, body
    });
    // v1.7 §5.1 — write-through index update so the new profile is
    // immediately visible to loadIndex-based tools (recall, list-platform-profiles)
    // without requiring a manual reindex.
    await upsertPage(ctx.vaultPath, result.path);

    return {
      id: result.id,
      path: result.path,
      pokemon,
      profile_summary: {
        pokemon_type: pokemonType,
        evolution_stage: parsed.evolution_stage
      }
    };
  }
};
