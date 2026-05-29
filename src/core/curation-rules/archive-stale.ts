import { registerCurationRule } from "../curation-rule.js";
import type { CurationCtx, CurationAction } from "../curation-rule.js";

registerCurationRule({
  code: "ARCHIVE_STALE",
  run(ctx: CurationCtx): CurationAction[] {
    const today = ctx.today.toISOString().slice(0, 10);
    const cutoff = ctx.today.getTime() - ctx.config.archive_stale_days * 864e5;
    const out: CurationAction[] = [];
    for (const c of ctx.candidates) {
      if (c.status !== "draft") continue;
      if (c.inbound_link_count > 0) continue;
      const last = c.updated ?? c.created;
      if (!last || isNaN(Date.parse(last)) || Date.parse(last) >= cutoff) continue;
      const ageDays = Math.floor((ctx.today.getTime() - Date.parse(last)) / 864e5);
      out.push({
        code: "ARCHIVE_STALE",
        page_id: c.page_id,
        wiki: c.wiki,
        from_status: "draft",
        to_status: "archived",
        evidence: `untouched ${ageDays}d, 0 inbound links`,
        confidence: "high",
        author_class: c.author_class,
        field_patch: { archived_at: today },
        applies: false,
      });
    }
    return out;
  },
});
