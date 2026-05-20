import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../core/frontmatter.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { listTasks } from "../core/tasks.js";
import { computeChannelActivity, loadAsciiHeader, formatAsciiHeader } from "../core/start.js";
import { resolveFamily, membersOf } from "../core/family.js";
import { loadIndex } from "../core/index.js";
import { findOnDisk } from "../core/disk-fallback.js";
import { resolveWiki } from "./_resolve-wiki.js";
import {
  renderSprite,
  SpriteRenderError,
  SpriteVariantNotAvailableError,
  type SpriteVariant,
  type ColorMode,
  type Fetcher
} from "../core/sprites-runtime.js";
import { readDisplayConfig } from "../core/display-config.js";

const Input = z.object({
  wiki: z.string().optional(),
  // Phase-2 T3-4 — when set without `wiki:`, the brief assembles each
  // family member's `map.md` into a single sectioned context document.
  // Resolved via `core/family.resolveFamily` (explicit > ctx.defaultFamily
  // > .active-family > null). Explicit `wiki:` bypasses family aggregation.
  family: z.string().optional(),
  pokemon: z.string().optional(),
  topics: z.array(z.string()).optional(),
  since: z.string().datetime().optional()
});

// Phase-2 T3-4 — `mode:` declaration formats accepted in each member's
// `wikis/<name>/CLAUDE.md`. Mirrors the regex pair already battle-tested in
// `core/lint-checks/family-member-mode-drift.ts`. The reindex pipeline currently
// hardcodes `mode: "mixed"` on `IndexedWiki` (TODO referenced in core/reindex.ts),
// so for member section headers we re-read CLAUDE.md directly here. Once
// `core/wikis.loadWikiMeta` is extended to surface `mode:` (out of scope for
// T3-4), swap this to consume that.
//
// Two declaration shapes:
//   - markdown bold with the colon INSIDE the bold: `**Mode:** project-doc`
//     (current `vault_new-wiki` output).
//   - plain key:value:                              `mode: project-doc`
//     (per spec §5.1's example).
const WIKI_MODE_LINE = /^\s*(?:\*\*\s*mode\s*:\s*\*\*|mode\s*:)\s*([^\s].*?)\s*$/im;

// v1.6 Phase 3 T4-1 — Pokemon-type → statusline emoji glyph table.
// Mirrors `scripts/statusline-pokemon.{sh,ps1}` 1:1 (the v1.5 statusline
// scripts that reach into `_index/profiles.json` for the emoji case-mapping
// today). This module owns the mapping for the `_index/statusline.json`
// write path so consumers don't need to re-derive it. When `display_config.
// statusline.emoji_safe_mode: true`, we substitute a `[<typename>]` text
// fallback for terminals that render emoji as tofu (notably Windows Terminal
// edge cases). Spec §10.3.
const TYPE_EMOJI: Record<string, string> = {
  normal: "⚪", fire: "🔥", water: "💧", electric: "⚡", grass: "🌿", ice: "❄️",
  fighting: "🥊", poison: "☠️", ground: "⛰️", flying: "🪶", psychic: "🔮", bug: "🐛",
  rock: "🪨", ghost: "👻", dragon: "🐉", dark: "🌑", steel: "⚙️", fairy: "✨"
};

function typeLabel(pokemonType: string, emojiSafeMode: boolean): string {
  if (emojiSafeMode) return `[${pokemonType}]`;
  return TYPE_EMOJI[pokemonType] ?? "⚪";
}

interface StatuslineJson {
  name: string;
  pokemon_type: string;
  type_label: string;
  evolution_stage: string;
  tasks_in_flight: number;
  emoji_safe_mode: boolean;
}

function writeStatuslineJson(vaultPath: string, payload: StatuslineJson): void {
  const indexDir = join(vaultPath, "_index");
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
  writeFileSync(
    join(indexDir, "statusline.json"),
    JSON.stringify(payload, null, 2)
  );
}

function readWikiMode(vaultPath: string, wiki: string): string | undefined {
  const claudePath = join(vaultPath, "wikis", wiki, "CLAUDE.md");
  if (!existsSync(claudePath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(claudePath, "utf8");
  } catch {
    return undefined;
  }
  const m = raw.match(WIKI_MODE_LINE);
  if (!m) return undefined;
  const mode = m[1].trim();
  return mode.length > 0 ? mode : undefined;
}

const ChannelActivityItem = z.object({
  channel: z.string(),
  unread_count: z.number().int().nonnegative(),
  last_entry_summary: z.string()
});

const ActivePageSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string()
});

const ActiveTaskSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string()
});

const PokemonState = z.object({
  name: z.string(),
  pokemon_type: z.string(),
  evolution_stage: z.string(),
  active_tasks: z.array(ActiveTaskSummary)
});

const Output = z.object({
  map_summary: z.string(),
  active_pages_summary: z.array(ActivePageSummary),
  recall_hits: z.array(z.unknown()),
  channel_activity: z.array(ChannelActivityItem),
  pokemon_state: PokemonState.optional(),
  ascii_header: z.string().optional()
});

export type StartOutput = z.infer<typeof Output>;

export const startTool = {
  name: "vault_start",
  description: "Cold-session bootstrap: reads wiki map, tails active channels, runs recall on primary topics, returns a context brief.",
  inputSchema: Input,
  outputSchema: Output,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; defaultFamily?: string; fetcher?: typeof fetch }
  ): Promise<StartOutput> => {
    const sinceCutoff = input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Phase-2 T3-4 — resolve family scope BEFORE wiki resolution so that
    // an `--family=<name>` (no `--wiki=`) call doesn't require .active-wiki.
    // Explicit `--wiki=` short-circuits family aggregation entirely (single-
    // wiki behaviour unchanged from v1.5).
    //
    // We pass the index's wiki map to `resolveFamily` so it can sanity-check
    // a wiki/family combo when both are explicitly provided. T3-6 (parallel)
    // wires `ctx.defaultFamily` from `--default-family`/`.active-family`; if
    // it isn't populated yet, the resolution chain just falls through.
    const idx = loadIndex(ctx.vaultPath);
    const knownWikis: Record<string, { family?: string | null }> = {};
    for (const w of idx.wikis) {
      knownWikis[w.name] = { family: w.family ?? null };
    }
    const resolvedFamily = input.wiki
      ? null
      : resolveFamily(
          { vaultPath: ctx.vaultPath, defaultFamily: ctx.defaultFamily },
          input.family,
          input.wiki,
          knownWikis
        );

    // Phase-2 T3-4 — family-mode brief: concatenate each member's `map.md`
    // end-to-end with per-member section headers. Sorted alphabetically via
    // `membersOf`. Profile + channel logic below is unchanged (single profile,
    // not forked). When `family:` resolved to null OR `wiki:` is explicit,
    // fall through to v1.5 single-wiki behaviour.
    let wiki: string;
    let mapSummary: string;
    if (resolvedFamily) {
      const members = membersOf(resolvedFamily, knownWikis);
      // Use the first member as the "scope wiki" for downstream lookups
      // (active pages, etc.) so we still surface SOMETHING per-member; the
      // brief itself is family-wide. Fall back to defaultWiki if the family
      // has no members (degenerate case — shape stays valid).
      wiki = members[0] ?? ctx.defaultWiki ?? resolvedFamily;
      const sections: string[] = [];
      for (const member of members) {
        const memberMapPath = join(ctx.vaultPath, "wikis", member, "map.md");
        const memberMode = readWikiMode(ctx.vaultPath, member) ?? "unknown";
        let memberBody = "(no map.md found for wiki)";
        if (existsSync(memberMapPath)) {
          try {
            const raw = readFileSync(memberMapPath, "utf8");
            const { body } = parseFrontmatter(raw);
            memberBody = body;
          } catch { /* keep placeholder */ }
        }
        sections.push(`## ${member} (mode: ${memberMode})\n\n${memberBody}`);
      }
      mapSummary = sections.length > 0
        ? sections.join("\n\n")
        : `(family '${resolvedFamily}' has no members)`;
    } else {
      wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);

      // 1. Map summary
      const mapPath = join(ctx.vaultPath, "wikis", wiki, "map.md");
      mapSummary = "(no map.md found for wiki)";
      if (existsSync(mapPath)) {
        const raw = readFileSync(mapPath, "utf8");
        const { body } = parseFrontmatter(raw);
        mapSummary = body.split("\n").slice(0, 25).join("\n");
      }
    }

    // 2. Active pages
    const activePages: z.infer<typeof ActivePageSummary>[] = [];
    const wikiDir = join(ctx.vaultPath, "wikis", wiki);
    if (existsSync(wikiDir)) {
      for (const folder of ["concepts", "decisions", "specs", "guides", "ideas", "questions"]) {
        const fdir = join(wikiDir, folder);
        if (!existsSync(fdir)) continue;
        for (const file of readdirSync(fdir).filter(f => f.endsWith(".md"))) {
          try {
            const raw = readFileSync(join(fdir, file), "utf8");
            const { frontmatter: fm } = parseFrontmatter(raw);
            if (fm.status === "active" || fm.status === "accepted") {
              activePages.push({
                id: String(fm.id),
                title: String(fm.title ?? fm.id),
                status: String(fm.status),
                summary: String(fm.summary ?? "")
              });
            }
          } catch { /* skip */ }
        }
      }
    }

    // 3. Pokemon state + channels_tailed lookup
    let pokemonState: z.infer<typeof PokemonState> | undefined = undefined;
    let channelsTailed: string[] = [];
    let pokeapiUrl: string | undefined = undefined;
    let spriteVariant: SpriteVariant = "front_default";
    if (input.pokemon) {
      const profileId = input.pokemon.startsWith("profile-")
        ? input.pokemon
        : `profile-${input.pokemon}`;
      // Fast path: readProfile (looks in wikis/_agents/profiles + alias overlay).
      // Slow path (v1.7 §5.4): findOnDisk fallback when the profile lives in a
      // non-canonical location (e.g., authored under a non-_agents wiki, or
      // moved between wikis without alias-recording). Index-first semantics
      // preserved — the disk scan only fires on miss.
      let profileFm: Record<string, any> | null = null;
      try {
        const p = readProfile(ctx.vaultPath, profileId);
        profileFm = p.frontmatter;
      } catch (e) {
        if (!(e instanceof ProfileNotFoundError)) throw e;
        const onDisk = findOnDisk(ctx.vaultPath, profileId);
        if (onDisk && onDisk.type === "profile") {
          profileFm = onDisk.frontmatter;
        }
      }
      if (profileFm) {
        const name = profileId.slice("profile-".length);
        const claimedTasks = listTasks(ctx.vaultPath, {
          claimed_by: `agent:${name}`,
          status: "in_progress"
        });
        pokemonState = {
          name,
          pokemon_type: String(profileFm.pokemon_type ?? "normal"),
          evolution_stage: String(profileFm.evolution_stage ?? "basic"),
          active_tasks: claimedTasks.map(t => ({
            id: t.id, title: t.title, status: t.status
          }))
        };
        if (Array.isArray(profileFm.channels_tailed)) {
          channelsTailed = profileFm.channels_tailed.map(String);
        }
        // v1.6 Phase 3 T2-1 — sprite render inputs from profile frontmatter.
        if (typeof profileFm.pokeapi_url === "string" && profileFm.pokeapi_url.length > 0) {
          pokeapiUrl = profileFm.pokeapi_url;
        }
        if (typeof profileFm.sprite_variant === "string" && profileFm.sprite_variant.length > 0) {
          spriteVariant = profileFm.sprite_variant as SpriteVariant;
        }
      }
    }

    // 4. Channel activity — driven by profile.channels_tailed via core/start.ts
    const channelActivity = computeChannelActivity(ctx.vaultPath, channelsTailed, {
      since: sinceCutoff,
      wiki
    });

    // 5. Sprite render path (v1.6 Phase 3 T2-1) + statusline JSON write (T4-1).
    //
    // Two-tier fallback for sprite rendering:
    //   - SpriteVariantNotAvailableError → retry once with `front_default`.
    //   - any other SpriteRenderError (or unknown throw) → empty sprite block;
    //     /start MUST still succeed.
    //
    // `renderSprite` already handles hand-authored precedence + cache hits
    // internally; we just call it and trust the output. If `pokeapi_url` is
    // unset on the profile we fall back to the legacy hand-authored-only path
    // via `loadAsciiHeader` (existing behaviour for profiles authored before
    // this field landed).
    //
    // Display config (T4-1) drives BOTH sprite color_mode AND the
    // `_index/statusline.json` emoji-vs-text-fallback choice. Read once.
    let asciiHeader: string | undefined = undefined;
    if (pokemonState) {
      const displayCfg = readDisplayConfig(ctx.vaultPath);

      // Statusline JSON — written every /start with a pokemon arg, regardless
      // of whether the sprite renders. The v1.5 / Plan D scripts at
      // scripts/statusline.{sh,ps1} (and the per-task statusline shipped via
      // bootstrap-repo) consume this file. `type_label` is pre-resolved here
      // so consumers don't need to hold their own emoji table.
      writeStatuslineJson(ctx.vaultPath, {
        name: pokemonState.name,
        pokemon_type: pokemonState.pokemon_type,
        type_label: typeLabel(pokemonState.pokemon_type, displayCfg.statusline.emoji_safe_mode),
        evolution_stage: pokemonState.evolution_stage,
        tasks_in_flight: pokemonState.active_tasks.length,
        emoji_safe_mode: displayCfg.statusline.emoji_safe_mode
      });

      const unreadTotal = channelActivity.reduce((sum, c) => sum + c.unread_count, 0);
      const headerState = { unread_total: unreadTotal };

      if (pokeapiUrl && ctx.fetcher) {
        const colorMode: ColorMode = displayCfg.sprites.color_mode;
        const fetcher: Fetcher = ctx.fetcher;
        const baseInput = {
          pokeapiUrl,
          bareSpriteName: pokemonState.name.toLowerCase(),
          colorMode,
          vaultPath: ctx.vaultPath,
          fetcher
        };
        try {
          const out = await renderSprite({ ...baseInput, spriteVariant });
          asciiHeader = formatAsciiHeader(out.ascii_lines, pokemonState, headerState);
        } catch (e) {
          if (e instanceof SpriteVariantNotAvailableError && spriteVariant !== "front_default") {
            // Tier-1 fallback: variant unavailable on the upstream entry, retry
            // once with the canonical front_default sprite. Logged to stderr so
            // operators can see the degradation; /start itself remains green.
            process.stderr.write(
              `[vault_start] sprite variant '${spriteVariant}' unavailable for ${pokemonState.name}; falling back to front_default\n`
            );
            try {
              const out = await renderSprite({ ...baseInput, spriteVariant: "front_default" });
              asciiHeader = formatAsciiHeader(out.ascii_lines, pokemonState, headerState);
            } catch (e2) {
              // Tier-2 fallback: any failure on the retry → no sprite.
              if (!(e2 instanceof SpriteRenderError)) throw e2;
              asciiHeader = undefined;
            }
          } else if (e instanceof SpriteRenderError) {
            // Tier-2 fallback: generic render failure → no sprite, /start still wins.
            asciiHeader = undefined;
          } else {
            throw e;
          }
        }
      } else {
        // No pokeapi_url declared on the profile → fall back to the v1.5
        // hand-authored-only header path. Preserves the 6-cartoon UX.
        asciiHeader = loadAsciiHeader(ctx.vaultPath, pokemonState, headerState);
      }
    }

    return {
      map_summary: mapSummary,
      active_pages_summary: activePages.slice(0, 20),
      recall_hits: [],
      channel_activity: channelActivity,
      pokemon_state: pokemonState,
      ascii_header: asciiHeader
    };
  }
};
