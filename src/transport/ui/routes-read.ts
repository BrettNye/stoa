import type { Hono } from "hono";
import type {
  ApiHealth, ApiTask, ApiAgent, ApiSuggestion,
  ApiChannelSummary, ApiChannelEntry, ApiWiki,
} from "./types.js";
import { listTasks } from "../../core/tasks.js";
import { listAllChannels } from "../../core/channel.js";
import { listProfilesEnriched } from "../../core/profiles.js";
import { listWikis } from "../../core/wikis.js";
import { suggestByType } from "../../core/pokeapi.js";
import { mapDevSpecialty, isValidPokemonType } from "../../core/pokemon.js";
import { loadIndex } from "../../core/index.js";

export interface ReadRoutesCtx {
  vaultPath: string;
  fetcher: typeof fetch;
  defaultWiki?: string;
  startedAt: string;
}

// Derive a PokeAPI sprite URL from species name.
// Stoa does not proxy sprites through this route file (that lives in routes-sprites.ts),
// so we return the canonical PokeAPI sprite URL for display purposes.
function spriteUrlFor(pokemonName: string): string {
  return `/api/sprites/${pokemonName.toLowerCase()}.svg`;
}

export function mountReadRoutes(app: Hono, ctx: ReadRoutesCtx): void {
  const { vaultPath, fetcher } = ctx;

  // ------------------------------------------------------------------
  // GET /api/health
  // ------------------------------------------------------------------
  app.get("/api/health", (c) => {
    let wikiCount = 0;
    let indexedAt: string | null = null;
    try {
      const idx = loadIndex(vaultPath);
      wikiCount = idx.wikis.length;
      // Use last_touched of the most recently indexed wiki as a proxy for indexedAt
      if (idx.wikis.length > 0) {
        const sorted = [...idx.wikis].sort((a, b) =>
          b.last_touched.localeCompare(a.last_touched)
        );
        indexedAt = sorted[0].last_touched ?? null;
      }
    } catch {
      // vault path may not exist — return defaults
    }

    const body: ApiHealth = {
      ok: true,
      vault: vaultPath,
      wikis: wikiCount,
      indexedAt,
    };
    return c.json(body);
  });

  // ------------------------------------------------------------------
  // GET /api/tasks
  // Query params: wiki, status, limit
  // ------------------------------------------------------------------
  app.get("/api/tasks", (c) => {
    const wiki = c.req.query("wiki") ?? undefined;
    const status = c.req.query("status") as
      | "pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked"
      | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    let tasks: ApiTask[] = [];
    try {
      const raw = listTasks(vaultPath, { wiki, status, limit });
      tasks = raw.map((t) => {
        const apiTask: ApiTask = {
          id: t.id,
          title: t.title,
          wiki: t.wiki,
          status: (t.status as ApiTask["status"]) ?? "pending",
          updated: "",
        };
        if (t.claimed_by) apiTask.claimed_by = t.claimed_by;
        if (t.channel) apiTask.channel = t.channel;
        if (t.pokemon_type) apiTask.required_pokemon_type = t.pokemon_type;
        return apiTask;
      });
    } catch {
      // Return empty array on any error (e.g. missing vault)
    }

    return c.json(tasks);
  });

  // ------------------------------------------------------------------
  // GET /api/agents
  // Query params: wiki (scope to one wiki)
  // ------------------------------------------------------------------
  app.get("/api/agents", (c) => {
    const wiki = c.req.query("wiki") ?? undefined;

    let agents: ApiAgent[] = [];
    try {
      const profiles = listProfilesEnriched(vaultPath, { wiki });
      agents = profiles.map((p) => {
        const agent: ApiAgent = {
          id: p.id,
          wiki: p.wiki,
          pokemon: p.pokemon,
          evolution_stage: (p.evolution_stage as ApiAgent["evolution_stage"]) ?? "basic",
          spriteUrl: spriteUrlFor(p.pokemon),
          updated: p.updated,
          claimedTaskCount: p.claimedTaskCount,
        };
        if (p.pokemon_type) agent.pokemon_type = p.pokemon_type;
        return agent;
      });
    } catch {
      // Return empty array on error
    }

    return c.json(agents);
  });

  // ------------------------------------------------------------------
  // GET /api/agents/suggest
  // Query params: specialty OR pokemon_type (at least one required)
  // Returns 400 if neither supplied or both invalid
  // ------------------------------------------------------------------
  app.get("/api/agents/suggest", async (c) => {
    const specialty = c.req.query("specialty") ?? undefined;
    const pokemonTypeParam = c.req.query("pokemon_type") ?? undefined;

    // Resolve the effective pokemon type
    let resolvedType: string | undefined;

    if (pokemonTypeParam !== undefined) {
      if (!isValidPokemonType(pokemonTypeParam)) {
        return c.json({ error: `Invalid pokemon_type: "${pokemonTypeParam}". Must be one of the 18 canonical types.` }, 400);
      }
      resolvedType = pokemonTypeParam;
    } else if (specialty !== undefined) {
      resolvedType = mapDevSpecialty(specialty);
    } else {
      return c.json({ error: "At least one of 'specialty' or 'pokemon_type' is required." }, 400);
    }

    let suggestions: ApiSuggestion[] = [];
    try {
      const raw = await suggestByType(vaultPath, resolvedType, { fetcher });
      suggestions = raw.map((s) => ({
        name: s.name,
        pokemon_type: s.pokemon_type,
        spriteUrl: s.sprite_url ?? spriteUrlFor(s.name),
      }));
    } catch {
      // On network / cache error return empty list rather than 500
    }

    return c.json(suggestions);
  });

  // ------------------------------------------------------------------
  // GET /api/channels
  // Returns both a `channels` summary array AND a flat `entries` array
  // sorted newest-first (single round-trip decision).
  // ------------------------------------------------------------------
  app.get("/api/channels", (c) => {
    let channels: ApiChannelSummary[] = [];
    let entries: ApiChannelEntry[] = [];

    try {
      const summaries = listAllChannels(vaultPath);

      channels = summaries.map((s) => {
        const lastEntry: ApiChannelEntry | null = s.lastEntry
          ? {
              id: s.lastEntry.id,
              channel: s.lastEntry.channel,
              wiki: s.lastEntry.wiki,
              author: s.lastEntry.author,
              ts: s.lastEntry.ts,
              excerpt: s.lastEntry.excerpt,
              pageId: s.lastEntry.pageId,
            }
          : null;

        return {
          name: s.name,
          wiki: s.wiki,
          lastEntry,
          count24h: s.count24h,
        };
      });

      // Flat entries: all lastEntry values that are non-null, sorted newest-first
      entries = channels
        .filter((ch) => ch.lastEntry !== null)
        .map((ch) => ch.lastEntry as ApiChannelEntry)
        .sort((a, b) => b.ts.localeCompare(a.ts));
    } catch {
      // Return empty on error
    }

    return c.json({ channels, entries });
  });

  // ------------------------------------------------------------------
  // GET /api/wikis
  // ------------------------------------------------------------------
  app.get("/api/wikis", (c) => {
    let wikis: ApiWiki[] = [];

    try {
      const rawWikis = listWikis(vaultPath);

      wikis = rawWikis.map((w) => {
        // pageCount: sum of all values in page_counts
        const pageCount = w.page_counts
          ? Object.values(w.page_counts).reduce((sum, n) => sum + n, 0)
          : 0;

        // activeTasks: count tasks in this wiki with status=pending or claimed
        let activeTasks = 0;
        try {
          const pending = listTasks(vaultPath, { wiki: w.name, status: "pending" });
          const claimed = listTasks(vaultPath, { wiki: w.name, status: "claimed" });
          activeTasks = pending.length + claimed.length;
        } catch {
          // leave as 0
        }

        return {
          name: w.name,
          mode: w.mode ?? "mixed",
          pageCount,
          activeTasks,
        };
      });
    } catch {
      // Return empty on error
    }

    return c.json(wikis);
  });
}
