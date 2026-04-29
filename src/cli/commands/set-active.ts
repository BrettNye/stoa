import { Command } from "commander";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCtx } from "../_ctx.js";

export function registerSetActive(p: Command) {
  p.command("set-active <wiki>")
    .description("Set the .active-wiki pointer at vault root")
    .action(async (wiki) => {
      const ctx = getCtx();
      if (!existsSync(join(ctx.vaultPath, "wikis", wiki))) throw new Error(`wiki does not exist: ${wiki}`);
      writeFileSync(join(ctx.vaultPath, ".active-wiki"), wiki + "\n");
      console.log(`active wiki: ${wiki}`);
    });
}
