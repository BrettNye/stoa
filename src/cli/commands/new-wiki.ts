import { Command } from "commander";
import { newWiki } from "../../core/wikis.js";
import { getCtx } from "../_ctx.js";

export function registerNewWiki(p: Command) {
  p.command("new-wiki <name>")
    .description("Scaffold a new wiki")
    .requiredOption("--mode <mode>", "idea-map|project-doc|learning|mixed")
    .requiredOption("--scope <scope>")
    .action(async (name, opts) => {
      const ctx = getCtx();
      const r = newWiki(ctx.vaultPath, { name, mode: opts.mode, scope: opts.scope });
      console.log(`created wiki: ${r.name} at ${r.path} (${r.files_created.length} files)`);
    });
}
