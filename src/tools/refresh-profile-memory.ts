import { z } from "zod";
import { synthesize } from "../core/synthesize.js";
import { readProfile } from "../core/profiles.js";

const Input = z.object({
  pokemon_id: z.string()
});

function bareName(pokemonId: string): string {
  return pokemonId.startsWith("profile-") ? pokemonId.slice("profile-".length) : pokemonId;
}

export const refreshProfileMemoryTool = {
  name: "vault.refresh-profile-memory",
  description: "Compile a per-agent memory synthesis at wikis/_agents/synthesis/synthesis-<bare-name>-memory.md from the agent's journals + claimed tasks. Idempotent (overwrites). Convenience wrapper around vault.synthesize with by_agent + scope=memory.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    // Verify the profile exists; readProfile throws ProfileNotFoundError otherwise
    readProfile(ctx.vaultPath, input.pokemon_id);

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
      last_compiled: result.last_compiled
    };
  }
};
