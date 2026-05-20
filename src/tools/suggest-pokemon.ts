import { z } from "zod";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { suggestByType } from "../core/pokeapi.js";
import { mapDevSpecialty, isValidPokemonType } from "../core/pokemon.js";

const Input = z.object({
  pokemon_type: z.string().optional(),
  dev_specialty: z.string().optional(),
  evolution_stage: z.enum(["basic", "stage1", "stage2"]).optional(),
  exclude_existing: z.boolean().default(true),
  limit: z.number().int().positive().default(5)
});

function listExistingProfileNames(vaultPath: string): Set<string> {
  const out = new Set<string>();
  const dir = join(vaultPath, "wikis", "_agents", "profiles");
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const id = file.replace(/\.md$/, "");
    const bare = id.startsWith("profile-") ? id.slice("profile-".length) : id;
    out.add(bare.toLowerCase());
  }
  return out;
}

export const suggestPokemonTool = {
  name: "vault_suggest-pokemon",
  description: "Suggest Pokemon names matching a type or dev specialty (e.g. 'backend' → fire). Uses PokeAPI; cached 30 days. Excludes existing profile names by default.",
  inputSchema: Input,
  handler: async (
    input: unknown,
    ctx: { vaultPath: string; fetcher?: typeof fetch }
  ) => {
    const parsed = Input.parse(input);
    let pokemonType = parsed.pokemon_type;
    if (!pokemonType && parsed.dev_specialty) {
      pokemonType = mapDevSpecialty(parsed.dev_specialty);
    }
    if (!pokemonType) {
      throw new Error("either pokemon_type or dev_specialty is required");
    }
    if (!isValidPokemonType(pokemonType)) {
      throw new Error(`invalid pokemon_type: ${pokemonType}`);
    }

    const all = await suggestByType(ctx.vaultPath, pokemonType, { fetcher: ctx.fetcher });
    let filtered = all;
    if (parsed.exclude_existing) {
      const existing = listExistingProfileNames(ctx.vaultPath);
      filtered = filtered.filter(s => !existing.has(s.name.toLowerCase()));
    }
    return {
      suggestions: filtered.slice(0, parsed.limit)
    };
  }
};
