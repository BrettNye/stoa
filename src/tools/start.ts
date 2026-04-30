import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../core/frontmatter.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { listTasks } from "../core/tasks.js";
import { computeChannelActivity, loadAsciiHeader } from "../core/start.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  wiki: z.string().optional(),
  pokemon: z.string().optional(),
  topics: z.array(z.string()).optional(),
  since: z.string().datetime().optional()
});

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
    ctx: { vaultPath: string; defaultWiki?: string }
  ): Promise<StartOutput> => {
    const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
    const sinceCutoff = input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 1. Map summary
    const mapPath = join(ctx.vaultPath, "wikis", wiki, "map.md");
    let mapSummary = "(no map.md found for wiki)";
    if (existsSync(mapPath)) {
      const raw = readFileSync(mapPath, "utf8");
      const { body } = parseFrontmatter(raw);
      mapSummary = body.split("\n").slice(0, 25).join("\n");
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
