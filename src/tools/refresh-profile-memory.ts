import { z } from "zod";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { synthesize } from "../core/synthesize.js";
import { ProfileNotFoundError } from "../core/profiles.js";
import { resolveTrainerContext, type TrainerContext } from "../core/resolve-trainer-context.js";

const Input = z.object({
  pokemon_id: z.string(),
  wiki: z.string().optional()
});

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-") ? pokemonId.slice("profile-".length) : pokemonId;
}

export const refreshProfileMemoryTool = {
  name: "vault.refresh-profile-memory",
  description: "Compile a per-agent memory synthesis at wikis/_agents/synthesis/synthesis-<bare-name>-memory.md from the agent's journals + claimed tasks. Idempotent (overwrites). Convenience wrapper around vault.synthesize with by_agent + scope=memory.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const parsed = Input.parse(input);
    // Resolve trainer context for ambient caller_trainer_id and wiki routing.
    // If explicit wiki: arg is provided, trainer resolution is best-effort only.
    // If no explicit wiki: arg, any TrainerContextError propagates — no fallback.
    let trainerCtx: TrainerContext | undefined;
    if (!parsed.wiki) {
      trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
    } else {
      try {
        trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
      } catch {
        trainerCtx = undefined;
      }
    }
    const wiki = parsed.wiki ?? trainerCtx?.wiki;
    if (!wiki) throw new Error("wiki resolution failed: no explicit arg and no resolved trainer context");

    // Verify the profile exists in the wiki-scoped path
    const profilePath = join(ctx.vaultPath, "wikis", wiki, "profiles", `${input.pokemon_id}.md`);
    if (!existsSync(profilePath)) {
      throw new ProfileNotFoundError(input.pokemon_id);
    }

    const agent = bareName(input.pokemon_id);
    const result = synthesize(ctx.vaultPath, {
      topic: `${agent} memory`,
      by_agent: agent,
      scope: "memory"
    });

    return {
      memory_page_id: result.id,
      path: result.path,
      inputs_used_count: result.inputs_used.length,
      last_compiled: result.last_compiled,
      caller_trainer_id: trainerCtx?.trainerId
    };
  }
};
