import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import type { Diagnostic } from "../lint.js";

/**
 * ACTIVE_WIKI_DIVERGENCE (severity:info) — surfaces when the per-repo MCP
 * arg `--default-wiki=<X>` (carried on `ctx.defaultWiki`) disagrees with
 * the vault-global `.active-wiki` file. This is a soft hint: per the
 * documented resolution order (`tool-arg > --default-wiki > .active-wiki`)
 * the per-repo arg legitimately overrides the global, but a divergence is
 * worth flagging so an operator running lint inside that repo can confirm
 * the override is intentional.
 *
 * No diagnostic when:
 *   - `ctx.defaultWiki` is undefined (no per-repo override is in play).
 *   - `<vaultPath>/.active-wiki` is absent (no global active wiki set).
 *   - the file exists but is empty/whitespace (treated as unset).
 *   - the trimmed contents match `ctx.defaultWiki`.
 */
registerLintCheck({
  code: "ACTIVE_WIKI_DIVERGENCE",
  run(ctx, _idx, _input) {
    if (ctx.defaultWiki === undefined) return [];

    const activeWikiPath = join(ctx.vaultPath, ".active-wiki");
    let raw: string;
    try {
      raw = readFileSync(activeWikiPath, "utf8");
    } catch {
      // Any read error (ENOENT included) — no .active-wiki to diverge from.
      return [];
    }

    const activeWiki = raw.trim();
    if (activeWiki === "") return [];
    if (activeWiki === ctx.defaultWiki) return [];

    const diagnostic: Diagnostic = {
      severity: "info",
      code: "ACTIVE_WIKI_DIVERGENCE",
      message:
        `--default-wiki="${ctx.defaultWiki}" diverges from .active-wiki="${activeWiki}" ` +
        `(at ${activeWikiPath})`,
      suggestion:
        "this is a soft hint — per resolution order --default-wiki wins for this session. " +
        "If unintended, update .active-wiki or remove --default-wiki from .mcp.json.",
    };
    return [diagnostic];
  },
});
