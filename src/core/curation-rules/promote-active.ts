import { registerCurationRule } from "../curation-rule.js";
import type { CurationCtx, CurationAction } from "../curation-rule.js";

registerCurationRule({
  code: "PROMOTE_ACTIVE",
  run(ctx: CurationCtx): CurationAction[] {
    const cutoff = ctx.today.getTime() - ctx.config.promote_active_recent_days * 864e5;
    const out: CurationAction[] = [];
    for (const c of ctx.candidates) {
      if (c.status !== "draft") continue;
      const recent = c.updated ? Date.parse(c.updated) >= cutoff : false;
      if (c.inbound_link_count < 1 && !recent) continue;
      const hasSummary =
        typeof c.frontmatter.summary === "string" &&
        (c.frontmatter.summary as string).trim().length > 0;
      const action: CurationAction = {
        code: "PROMOTE_ACTIVE",
        page_id: c.page_id,
        wiki: c.wiki,
        from_status: "draft",
        to_status: "active",
        evidence:
          c.inbound_link_count >= 1
            ? `${c.inbound_link_count} inbound link(s)`
            : "edited recently",
        confidence: "medium",
        author_class: c.author_class,
        applies: false,
      };
      if (!hasSummary) {
        action.flag_reason = "draft → active blocked: add summary";
      }
      out.push(action);
    }
    return out;
  },
});
