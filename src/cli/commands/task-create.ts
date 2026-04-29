import { Command } from "commander";
import { createTask } from "../../core/tasks.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerTaskCreate(p: Command) {
  p.command("task-create <title>")
    .description("Create a new task in a wiki's task queue")
    .option("--wiki <name>", "wiki for the task")
    .option("--description <text>", "task description")
    .option("--segregation <list>", "comma-separated path globs")
    .option("--required-pokemon-type <type>", "restrict claim to this pokemon type")
    .option("--channel <name>", "feature channel for coordination")
    .option("--blocking <list>", "comma-separated task ids that must complete first")
    .option("--estimate-minutes <n>", "rough effort estimate in minutes")
    .option("--json")
    .action(async (title: string, opts: any) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const r = createTask(ctx.vaultPath, {
        title,
        wiki,
        description: opts.description,
        segregation: opts.segregation ? opts.segregation.split(",") : undefined,
        blocking: opts.blocking ? opts.blocking.split(",") : undefined,
        channel: opts.channel,
        required_pokemon_type: opts.requiredPokemonType,
        estimate_minutes: opts.estimateMinutes ? Number(opts.estimateMinutes) : undefined
      });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`created: ${r.id} at ${r.path}`);
    });
}
