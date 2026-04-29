import { Command } from "commander";
import { tailChannel } from "../../core/channel.js";
import { getCtx } from "../_ctx.js";

export function registerChannelTail(p: Command) {
  p.command("channel-tail <channel>")
    .description("Pull recent entries on a coordination channel")
    .option("--since <iso>")
    .option("--limit <n>", "default 50", "50")
    .option("--wiki <name>")
    .option("--json")
    .action(async (channel, opts) => {
      const ctx = getCtx();
      const r = await tailChannel(ctx.vaultPath, { channel, since: opts.since, limit: Number(opts.limit), wiki: opts.wiki });
      if (opts.json) return console.log(JSON.stringify(r, null, 2));
      for (const e of r.entries) console.log(`[${e.created}] ${e.author}: ${e.body.split("\n")[0]}`);
      console.log(`\ncursor: ${r.cursor}`);
    });
}
