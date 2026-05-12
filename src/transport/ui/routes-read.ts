import { readFileSync, existsSync as fsExistsSync, readdirSync as fsReaddirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import type { Hono } from "hono";
import type {
  ApiHealth, ApiTask, ApiAgent, ApiSuggestion,
  ApiChannelSummary, ApiChannelEntry, ApiWiki,
  ApiSynthesisStaleness, ApiSynthesisStalenessResponse,
} from "./types.js";
import type { Rarity } from "./types.js";
import { listTasks } from "../../core/tasks.js";
import { listAllChannels, tailChannel } from "../../core/channel.js";
import { listProfilesEnriched } from "../../core/profiles.js";
import { listWikis } from "../../core/wikis.js";
import { suggestByType, fetchSpecies, classifyRarity } from "../../core/pokeapi.js";
import { mapDevSpecialty, isValidPokemonType } from "../../core/pokemon.js";
import { loadIndex } from "../../core/index.js";
import { listSynthesesWithStaleness } from "../../core/syntheses.js";
import { parseFrontmatter } from "../../core/frontmatter.js";

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
    const statusStr = c.req.query("status");
    const VALID_STATUSES = ["pending", "claimed", "in_progress", "completed", "failed", "blocked"] as const;
    if (statusStr !== undefined && statusStr !== null && !(VALID_STATUSES as readonly string[]).includes(statusStr)) {
      return c.json({ error: `Invalid status: "${statusStr}". Must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
    }
    const status = statusStr as
      | "pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked"
      | undefined;
    const limitStr = c.req.query("limit");
    let limit: number | undefined;
    if (limitStr !== undefined && limitStr !== null) {
      const parsed = parseInt(limitStr, 10);
      if (isNaN(parsed) || parsed < 1) {
        return c.json({ error: `Invalid limit: "${limitStr}". Must be a positive integer.` }, 400);
      }
      limit = parsed;
    }

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

    return c.json({ tasks, generatedAt: new Date().toISOString() });
  });

  // ------------------------------------------------------------------
  // GET /api/agents
  // Query params: wiki (scope to one wiki)
  // ------------------------------------------------------------------
  app.get("/api/agents", (c) => {
    const wiki = c.req.query("wiki") ?? undefined;

    let agents: ApiAgent[] = [];
    try {
      // listProfilesEnriched returns the core fields; we need is_shiny and rarity
      // from frontmatter directly. We read the frontmatter map via a thin approach:
      // re-read each file's frontmatter to pick up is_shiny and rarity.
      const profiles = listProfilesEnriched(vaultPath, { wiki });

      // Build a frontmatter lookup map by profile id
      const fmMap = new Map<string, Record<string, unknown>>();
      const wikisDir = pathJoin(vaultPath, "wikis");
      if (fsExistsSync(wikisDir)) {
        const wikiDirs = fsReaddirSync(wikisDir, { withFileTypes: true });
        for (const dirEntry of wikiDirs) {
          if (!dirEntry.isDirectory()) continue;
          const wikiName = dirEntry.name;
          const profilesDir = pathJoin(wikisDir, wikiName, "profiles");
          if (!fsExistsSync(profilesDir)) continue;
          const profileFiles = fsReaddirSync(profilesDir);
          for (const file of profileFiles) {
            if (!String(file).endsWith(".md")) continue;
            const id = String(file).replace(/\.md$/, "");
            try {
              const raw = readFileSync(pathJoin(profilesDir, String(file)), "utf8");
              const { frontmatter } = parseFrontmatter(raw);
              fmMap.set(id, frontmatter);
            } catch { /* skip malformed */ }
          }
        }
      }

      agents = profiles.map((p) => {
        const fm = fmMap.get(p.id) ?? {};
        const isShiny = fm.is_shiny === true;
        const spriteUrl = isShiny
          ? `/api/sprites/${encodeURIComponent(p.pokemon)}.svg?variant=front_shiny`
          : spriteUrlFor(p.pokemon);
        const rarity = fm.rarity as Rarity | undefined;

        const agent: ApiAgent = {
          id: p.id,
          wiki: p.wiki,
          pokemon: p.pokemon,
          evolution_stage: (p.evolution_stage as ApiAgent["evolution_stage"]) ?? "basic",
          spriteUrl,
          updated: p.updated,
          claimedTaskCount: p.claimedTaskCount,
        };
        if (p.pokemon_type) agent.pokemon_type = p.pokemon_type;
        if (rarity !== undefined) agent.rarity = rarity;
        agent.is_shiny = isShiny;
        return agent;
      });
    } catch {
      // Return empty array on error
    }

    return c.json({ agents, generatedAt: new Date().toISOString() });
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
      const raw = await suggestByType(vaultPath, resolvedType, { fetcher, evolution_stage: "basic" });
      suggestions = await Promise.all(raw.map(async (s) => {
        const species = await fetchSpecies(vaultPath, s.name, { fetcher });
        const rarity = species ? classifyRarity(species) : "common" as Rarity;
        return {
          name: s.name,
          pokemon_type: s.pokemon_type,
          spriteUrl: s.sprite_url ?? spriteUrlFor(s.name),
          rarity,
        };
      }));
    } catch {
      // On network / cache error return empty list rather than 500
    }

    return c.json({ suggestions });
  });

  // ------------------------------------------------------------------
  // GET /api/channels
  // Returns both a `channels` summary array AND a flat `entries` array
  // sorted newest-first (single round-trip decision).
  // ------------------------------------------------------------------
  app.get("/api/channels", (c) => {
    const channelLimitStr = c.req.query("limit");
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

      // Flat entries: ALL entries across all channels, sorted newest-first
      // Fetch all entries from each channel (no time restriction) and concatenate
      const entriesLimit = channelLimitStr ? parseInt(channelLimitStr, 10) : 50;
      const allEntries: ApiChannelEntry[] = [];
      for (const summary of summaries) {
        const tail = tailChannel(vaultPath, {
          channel: summary.name,
          wiki: summary.wiki,
          since: "1970-01-01T00:00:00.000Z",
          limit: 1000,
        });
        for (const e of tail.entries) {
          allEntries.push({
            id: e.id,
            channel: summary.name,
            wiki: e.wiki,
            author: e.author,
            ts: e.created,
            excerpt: e.body.trim().slice(0, 240),
            pageId: e.id,
          });
        }
      }
      entries = allEntries
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, entriesLimit);
    } catch {
      // Return empty on error
    }

    return c.json({ channels, entries });
  });

  // ------------------------------------------------------------------
  // GET /api/syntheses/staleness
  // Query params: wiki, min_lag_days
  // ------------------------------------------------------------------
  app.get("/api/syntheses/staleness", (c) => {
    const wiki = c.req.query("wiki") || undefined;
    const minLagStr = c.req.query("min_lag_days");
    let min_lag_days: number | undefined;
    if (minLagStr !== undefined) {
      const parsed = parseInt(minLagStr, 10);
      if (isNaN(parsed) || parsed < 0) {
        return c.json({ error: `Invalid min_lag_days: "${minLagStr}"` }, 400);
      }
      min_lag_days = parsed;
    }
    let syntheses: ApiSynthesisStaleness[] = [];
    try {
      syntheses = listSynthesesWithStaleness(vaultPath, { wiki, min_lag_days }) as ApiSynthesisStaleness[];
    } catch {
      // Cold vault or missing index — return empty list rather than 500
    }
    const body: ApiSynthesisStalenessResponse = { syntheses, generatedAt: new Date().toISOString() };
    return c.json(body);
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

    return c.json({ wikis });
  });
}
