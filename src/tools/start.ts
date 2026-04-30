import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../core/frontmatter.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { listTasks } from "../core/tasks.js";
import { computeChannelActivity, loadAsciiHeader } from "../core/start.js";
import { resolveFamily, membersOf } from "../core/family.js";
import { loadIndex } from "../core/index.js";
import { resolveWiki } from "./_resolve-wiki.js";

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
//     (current `vault.new-wiki` output).
//   - plain key:value:                              `mode: project-doc`
//     (per spec §5.1's example).
const WIKI_MODE_LINE = /^\s*(?:\*\*\s*mode\s*:\s*\*\*|mode\s*:)\s*([^\s].*?)\s*$/im;

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
  name: "vault.start",
  description: "Cold-session bootstrap: reads wiki map, tails active channels, runs recall on primary topics, returns a context brief.",
  inputSchema: Input,
  outputSchema: Output,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; defaultFamily?: string }
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
    if (input.pokemon) {
      try {
        const profileId = input.pokemon.startsWith("profile-")
          ? input.pokemon
          : `profile-${input.pokemon}`;
        const p = readProfile(ctx.vaultPath, profileId);
        const name = profileId.slice("profile-".length);
        const claimedTasks = listTasks(ctx.vaultPath, {
          claimed_by: `agent:${name}`,
          status: "in_progress"
        });
        pokemonState = {
          name,
          pokemon_type: String(p.frontmatter.pokemon_type ?? "normal"),
          evolution_stage: String(p.frontmatter.evolution_stage ?? "basic"),
          active_tasks: claimedTasks.map(t => ({
            id: t.id, title: t.title, status: t.status
          }))
        };
        if (Array.isArray(p.frontmatter.channels_tailed)) {
          channelsTailed = p.frontmatter.channels_tailed.map(String);
        }
      } catch (e) {
        if (!(e instanceof ProfileNotFoundError)) throw e;
      }
    }

    // 4. Channel activity — driven by profile.channels_tailed via core/start.ts
    const channelActivity = computeChannelActivity(ctx.vaultPath, channelsTailed, {
      since: sinceCutoff,
      wiki
    });

    let asciiHeader: string | undefined = undefined;
    if (pokemonState) {
      const unreadTotal = channelActivity.reduce((sum, c) => sum + c.unread_count, 0);
      asciiHeader = loadAsciiHeader(ctx.vaultPath, pokemonState, { unread_total: unreadTotal });
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
