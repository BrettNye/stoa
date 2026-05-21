import { Command } from "commander";
import { newMoveTool } from "../../tools/new-move.js";
import { getCtx } from "../_ctx.js";

export function registerNewMove(p: Command) {
  p.command("new-move <title>")
    .description("Scaffold a new move (portable SKILL.md) with v1.5 substrate frontmatter and standard headings pre-filled.")
    .requiredOption("--description <text>", "SKILL.md description field that runtimes use to decide when to trigger this move")
    .option("--wiki <name>", "wiki to scaffold under (defaults to active wiki)")
    .option("--name <slug>", "SKILL.md name field (defaults to title slug)")
    .option("--move-type <type>", "process | capability | domain | support (default: process)")
    .option("--applies-to <runtimes...>", "runtimes this move deploys into (default: claude-code)")
    .option("--pokemon-type <type>", "optional canonical pokemon type tag")
    .option("--tools-used <tools...>", "tools the move expects (e.g. Bash Edit Read)")
    .action(async (title: string, opts: {
      description: string;
      wiki?: string;
      name?: string;
      moveType?: string;
      appliesTo?: string[];
      pokemonType?: string;
      toolsUsed?: string[];
    }) => {
      const ctx = getCtx();
      const r = await newMoveTool.handler(
        {
          title,
          wiki: opts.wiki,
          name: opts.name,
          description: opts.description,
          move_type: opts.moveType as "process" | "capability" | "domain" | "support" | undefined,
          applies_to: opts.appliesTo,
          pokemon_type: opts.pokemonType,
          tools_used: opts.toolsUsed
        },
        { vaultPath: ctx.vaultPath, defaultWiki: ctx.defaultWiki }
      );
      console.log(`created: ${r.id} at ${r.path}`);
    });
}
