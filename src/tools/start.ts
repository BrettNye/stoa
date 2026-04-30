import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../core/frontmatter.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { listTasks } from "../core/tasks.js";
import { resolveWiki } from "./_resolve-wiki.js";

const Input = z.object({
  wiki: z.string().optional(),
  pokemon: z.string().optional(),
  topics: z.array(z.string()).optional(),
  since: z.string().datetime().optional()
});

export const startTool = {
  name: "vault.start",
  description: "Cold-session bootstrap: reads wiki map, tails active channels, runs recall on primary topics, returns a context brief.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string; defaultWiki?: string }) => {
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
    const activePages: { id: string; title: string; status: string; summary: string }[] = [];
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

    // 3. Channel activity (simple form: count journals/tasks per channel since cutoff)
    const channelCounts: Record<string, { count: number; lastSummary: string }> = {};
    const journalDir = join(wikiDir, "journal");
    if (existsSync(journalDir)) {
      for (const file of readdirSync(journalDir).filter(f => f.endsWith(".md"))) {
        try {
          const raw = readFileSync(join(journalDir, file), "utf8");
          const { frontmatter: fm, body } = parseFrontmatter(raw);
          const created = String(fm.created ?? "");
          if (fm.channel && created >= sinceCutoff) {
            const ch = String(fm.channel);
            const prev = channelCounts[ch] ?? { count: 0, lastSummary: "" };
            channelCounts[ch] = {
              count: prev.count + 1,
              lastSummary: body.slice(0, 120)
            };
          }
        } catch { /* skip */ }
      }
    }
    const channelActivity = Object.entries(channelCounts).map(([channel, v]) => ({
      channel,
      unread_count: v.count,
      last_entry_summary: v.lastSummary
    }));

    // 4. Pokemon state
    let pokemonState: any = undefined;
    if (input.pokemon) {
      try {
        const p = readProfile(ctx.vaultPath, input.pokemon);
        const name = input.pokemon.startsWith("profile-")
          ? input.pokemon.slice("profile-".length)
          : input.pokemon;
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
      } catch (e) {
        if (!(e instanceof ProfileNotFoundError)) throw e;
      }
    }

    return {
      map_summary: mapSummary,
      active_pages_summary: activePages.slice(0, 20),
      recall_hits: [],   // populated by caller via vault.recall; v1.5 leaves empty (slash command can fill)
      channel_activity: channelActivity,
      pokemon_state: pokemonState,
      ascii_header: undefined  // Phase 4 polish
    };
  }
};
