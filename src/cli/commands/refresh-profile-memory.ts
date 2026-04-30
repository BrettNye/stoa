import { Command } from "commander";
import { refreshProfileMemoryTool } from "../../tools/refresh-profile-memory.js";
import { getCtx } from "../_ctx.js";

export function registerRefreshProfileMemory(p: Command) {
  p.command("refresh-profile-memory <pokemon_id>")
    .description("Compile a per-agent memory synthesis from the agent's journals + claimed tasks. Idempotent.")
    .action(async (pokemonId: string) => {
      const ctx = getCtx();
      const r = await refreshProfileMemoryTool.handler({ pokemon_id: pokemonId }, { vaultPath: ctx.vaultPath });
      console.log(JSON.stringify(r, null, 2));
    });
}
