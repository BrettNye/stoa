import { Command } from "commander";
import { postToChannel } from "../../core/channel.js";
import { resolveWiki } from "../../tools/_resolve-wiki.js";
import { getCtx } from "../_ctx.js";

export function registerChannelPost(p: Command) {
  p.command("channel-post <channel> <content...>")
    .description("Post a message to a coordination channel")
    .option("--wiki <name>")
    .option("--agent-id <id>", "claude-code")
    .action(async (channel, content: string[], opts) => {
      const ctx = getCtx();
      const wiki = resolveWiki(opts.wiki, ctx.defaultWiki, ctx.vaultPath);
      const r = postToChannel(ctx.vaultPath, { channel, content: content.join(" "), wiki, agent_id: opts.agentId ?? "claude-code" });
      console.log(`posted: ${r.id} (channel: ${r.channel})`);
    });
}
