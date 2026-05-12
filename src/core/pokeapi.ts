import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface PokeAPIPokemon {
  name: string;
  types: string[];
  evolution_chain_url: string;
  sprite_url?: string;
}

export interface PokeAPIChainStage {
  name: string;
  pokeapi_url: string;
  types: string[];
}

export interface PokeAPIChain {
  stages: PokeAPIChainStage[];
}

export interface PokeAPISuggestion {
  name: string;
  pokemon_type: string;
  pokeapi_url: string;
  sprite_url?: string;
}

interface CacheEntry<T> {
  value: T;
  fetched_at: string;
}

interface Cache {
  [key: string]: CacheEntry<any>;
}

const CACHE_TTL_DAYS = 30;
const POKEAPI_BASE = "https://pokeapi.co/api/v2";

interface Opts {
  fetcher?: typeof fetch;
}

function cachePath(vaultPath: string): string {
  return join(vaultPath, "_index", "pokeapi-cache.json");
}

function readCache(vaultPath: string): Cache {
  const p = cachePath(vaultPath);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Cache;
  } catch {
    return {};
  }
}

function writeCache(vaultPath: string, cache: Cache): void {
  const p = cachePath(vaultPath);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch { /* tolerate */ }
  renameSync(tmp, p);
}

function isFresh(entry: CacheEntry<unknown>): boolean {
  const fetchedAt = new Date(entry.fetched_at).getTime();
  const ageMs = Date.now() - fetchedAt;
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs < ttlMs;
}

async function getCached<T>(vaultPath: string, key: string): Promise<T | null> {
  const cache = readCache(vaultPath);
  const e = cache[key];
  if (e && isFresh(e)) return e.value as T;
  return null;
}

function setCached<T>(vaultPath: string, key: string, value: T): void {
  const cache = readCache(vaultPath);
  cache[key] = { value, fetched_at: new Date().toISOString() };
  writeCache(vaultPath, cache);
}

async function doFetch(url: string, opts?: Opts): Promise<any> {
  const f = opts?.fetcher ?? fetch;
  const r = await f(url);
  if (!r.ok) throw new Error(`PokeAPI fetch failed: ${url} → ${r.status}`);
  return r.json();
}

export async function fetchPokemon(vaultPath: string, name: string, opts?: Opts): Promise<PokeAPIPokemon> {
  const key = `pokemon:${name.toLowerCase()}`;
  const cached = await getCached<PokeAPIPokemon>(vaultPath, key);
  if (cached) return cached;

  const raw = await doFetch(`${POKEAPI_BASE}/pokemon/${name.toLowerCase()}`, opts);
  const speciesUrl: string = raw.species?.url ?? "";
  const speciesRaw = speciesUrl ? await doFetch(speciesUrl, opts) : { evolution_chain: { url: "" } };

  const result: PokeAPIPokemon = {
    name: String(raw.name ?? name),
    types: Array.isArray(raw.types) ? raw.types.map((t: any) => String(t.type?.name ?? "")) : [],
    evolution_chain_url: String(speciesRaw.evolution_chain?.url ?? ""),
    sprite_url: raw.sprites?.front_default ? String(raw.sprites.front_default) : undefined
  };
  setCached(vaultPath, key, result);
  return result;
}

export async function fetchEvolutionChain(vaultPath: string, chainUrl: string, opts?: Opts): Promise<PokeAPIChain> {
  const key = `chain:${chainUrl}`;
  const cached = await getCached<PokeAPIChain>(vaultPath, key);
  if (cached) return cached;

  const raw = await doFetch(chainUrl, opts);
  const stages: PokeAPIChainStage[] = [];
  let cursor = raw.chain;
  while (cursor) {
    stages.push({
      name: String(cursor.species?.name ?? ""),
      pokeapi_url: String(cursor.species?.url ?? ""),
      types: []
    });
    cursor = Array.isArray(cursor.evolves_to) && cursor.evolves_to.length > 0 ? cursor.evolves_to[0] : null;
  }
  const result: PokeAPIChain = { stages };
  setCached(vaultPath, key, result);
  return result;
}

export async function nextEvolution(vaultPath: string, currentName: string, opts?: Opts): Promise<{ name: string; pokeapi_url: string } | null> {
  const p = await fetchPokemon(vaultPath, currentName, opts);
  if (!p.evolution_chain_url) return null;
  const chain = await fetchEvolutionChain(vaultPath, p.evolution_chain_url, opts);
  const idx = chain.stages.findIndex(s => s.name === currentName.toLowerCase());
  if (idx === -1 || idx === chain.stages.length - 1) return null;
  const next = chain.stages[idx + 1];
  return { name: next.name, pokeapi_url: next.pokeapi_url };
}

interface SpeciesData {
  evolves_from_species: { name: string; url: string } | null;
}

async function fetchSpecies(vaultPath: string, name: string, opts?: Opts): Promise<SpeciesData | null> {
  const key = `species:${name.toLowerCase()}`;
  const cached = await getCached<SpeciesData>(vaultPath, key);
  if (cached !== null) return cached;

  try {
    const raw = await doFetch(`${POKEAPI_BASE}/pokemon-species/${name.toLowerCase()}`, opts);
    const result: SpeciesData = {
      evolves_from_species: raw.evolves_from_species
        ? { name: String(raw.evolves_from_species.name ?? ""), url: String(raw.evolves_from_species.url ?? "") }
        : null
    };
    setCached(vaultPath, key, result);
    return result;
  } catch {
    return null;
  }
}

async function filterByEvolutionStage(
  vaultPath: string,
  candidates: PokeAPISuggestion[],
  stage: "basic" | "stage1" | "stage2",
  opts?: Opts
): Promise<PokeAPISuggestion[]> {
  const results: PokeAPISuggestion[] = [];

  for (const candidate of candidates) {
    try {
      const species = await fetchSpecies(vaultPath, candidate.name, opts);
      // If species fetch failed, exclude the candidate
      if (species === null) continue;

      if (stage === "basic") {
        if (species.evolves_from_species === null) {
          results.push(candidate);
        }
      } else if (stage === "stage1") {
        // stage1: has a predecessor, but predecessor is basic
        if (species.evolves_from_species !== null) {
          const predecessorSpecies = await fetchSpecies(vaultPath, species.evolves_from_species.name, opts);
          if (predecessorSpecies !== null && predecessorSpecies.evolves_from_species === null) {
            results.push(candidate);
          }
        }
      } else if (stage === "stage2") {
        // stage2: has a predecessor, and that predecessor also has a predecessor
        if (species.evolves_from_species !== null) {
          const predecessorSpecies = await fetchSpecies(vaultPath, species.evolves_from_species.name, opts);
          if (predecessorSpecies !== null && predecessorSpecies.evolves_from_species !== null) {
            results.push(candidate);
          }
        }
      }
    } catch {
      // Exclude on unexpected error
    }
  }

  return results;
}

export async function suggestByType(
  vaultPath: string,
  pokemonType: string,
  opts?: Opts & { evolution_stage?: "basic" | "stage1" | "stage2" }
): Promise<PokeAPISuggestion[]> {
  const key = `type:${pokemonType.toLowerCase()}`;
  const cached = await getCached<PokeAPISuggestion[]>(vaultPath, key);
  if (cached) {
    if (opts?.evolution_stage) {
      return filterByEvolutionStage(vaultPath, cached, opts.evolution_stage, opts);
    }
    return cached;
  }

  const raw = await doFetch(`${POKEAPI_BASE}/type/${pokemonType.toLowerCase()}`, opts);
  const list: PokeAPISuggestion[] = Array.isArray(raw.pokemon)
    ? raw.pokemon.map((p: any) => ({
        name: String(p.pokemon?.name ?? ""),
        pokemon_type: pokemonType.toLowerCase(),
        pokeapi_url: String(p.pokemon?.url ?? ""),
        sprite_url: undefined
      }))
    : [];
  setCached(vaultPath, key, list);

  if (opts?.evolution_stage) {
    return filterByEvolutionStage(vaultPath, list, opts.evolution_stage, opts);
  }
  return list;
}
