import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { thresholdFor, nextStage, EvolutionStage } from "../core/pokemon.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";

const Input = z.object({
  pokemon_id: z.string()
});

export const profileStatsTool = {
  name: "vault.profile-stats",
  description: "Returns per-profile counts (tasks completed/failed/in-flight, journals, channels active, moves-used frequency) plus next-evolution threshold.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const profilesJsonPath = join(ctx.vaultPath, "_index", "profiles.json");
    if (!existsSync(profilesJsonPath)) {
      throw new Error("PROFILE_NOT_FOUND: _index/profiles.json missing — run vault.reindex first");
    }
    const data = JSON.parse(readFileSync(profilesJsonPath, "utf8"));
    const row = data[input.pokemon_id];
    if (!row) {
      throw new Error(`PROFILE_NOT_FOUND: ${input.pokemon_id}`);
    }

    // Read profile to get created date for days_since_creation
    let daysSinceCreation = 0;
    try {
      const profile = readProfile(ctx.vaultPath, input.pokemon_id);
      const createdStr = String(profile.frontmatter.created ?? "");
      if (createdStr) {
        const created = new Date(createdStr);
        const now = new Date();
        daysSinceCreation = Math.max(0, Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)));
      }
    } catch (e) {
      if (!(e instanceof ProfileNotFoundError)) throw e;
    }

    const successRate = row.tasks_completed > 0
      ? row.tasks_completed / (row.tasks_completed + row.tasks_failed)
      : 0;

    const stage = row.evolution_stage as EvolutionStage;
    const next = nextStage(stage);
    let nextEvolutionThreshold: { stage: string; criteria: string; gap: string } | undefined;
    if (next !== null) {
      const transition = `${stage}-to-${next}` as "basic-to-stage1" | "stage1-to-stage2";
      const t = thresholdFor(transition);
      const tasksGap = Math.max(0, t.tasks_completed - row.tasks_completed);
      const rateGap = Math.max(0, t.success_rate - successRate);
      nextEvolutionThreshold = {
        stage: next,
        criteria: `${t.tasks_completed} tasks_completed at ${t.success_rate.toFixed(2)} success_rate`,
        gap: tasksGap > 0 || rateGap > 0
          ? `${tasksGap} more tasks, ${rateGap.toFixed(2)} more success rate`
          : "thresholds met"
      };
    }

    return {
      profile_id: input.pokemon_id,
      pokemon_type: row.pokemon_type,
      evolution_stage: row.evolution_stage,
      days_since_creation: daysSinceCreation,
      tasks_completed: row.tasks_completed,
      tasks_failed: row.tasks_failed,
      tasks_in_flight: row.tasks_in_flight,
      success_rate: successRate,
      journals_count: row.journals_count,
      channels_active: row.channels_active,
      moves_used_freq: row.moves_used_freq,
      next_evolution_threshold: nextEvolutionThreshold
    };
  }
};
