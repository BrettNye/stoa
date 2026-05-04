import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { parseFrontmatter } from "../frontmatter.js";
import { effectiveConfidence } from "../decay.js";
import { getClaimsConfig } from "../../config.js";
import type { Diagnostic } from "../lint.js";

// CLAIM_EFFECTIVE_BELOW_FLOOR (severity:info) — task-lint-below-floor (Claims
// Plan 1, foundation DAG).
//
// Walks every `wikis/<name>/claim/*.md` file. For each ACTIVE claim, computes
// `effectiveConfidence(claim, today, { half_life_days, effective_floor })` and
// compares it against `claims.render_min_confidence` (spec §6.2 default 0.4).
// When the effective confidence has decayed strictly below the render floor,
// emits a single info-severity diagnostic per claim — the claim has aged out
// of the `claims.render`-surfaced set and probably needs revalidation or
// retraction. Strict `<` so a claim sitting exactly at the floor is not
// flagged (it still renders).
//
// Non-active claims are skipped entirely. `effectiveConfidence` already
// returns 0 for superseded/retracted/draft, but those lifecycle states are
// deliberately closed and don't need an "act on this" lint signal.
//
// `today` is read from `ctx.today` so tests and the lint runner can inject
// a deterministic clock. When omitted (production), the check defaults to
// `new Date()` at run time. This mirrors `effectiveConfidence`'s contract.
//
// Config is loaded with `getClaimsConfig({})` for spec defaults — Plan 1
// hasn't yet plumbed raw vault config through the lint context. When a later
// task adds that, swap the source to `ctx.rawConfig` (or equivalent). The
// shape on disk for half_life_days / effective_floor / render_min_confidence
// hasn't changed, so the rule's behavior won't.

registerLintCheck({
  code: "CLAIM_EFFECTIVE_BELOW_FLOOR",
  run(ctx, _idx, _input) {
    const wikisDir = join(ctx.vaultPath, "wikis");
    if (!existsSync(wikisDir)) return [];

    const today = ctx.today ?? new Date();
    const cfg = getClaimsConfig({});

    const diagnostics: Diagnostic[] = [];

    let wikiNames: string[];
    try {
      wikiNames = readdirSync(wikisDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch {
      return [];
    }

    for (const wikiName of wikiNames) {
      const claimDir = join(wikisDir, wikiName, "claim");
      if (!existsSync(claimDir)) continue;

      let files: string[];
      try {
        files = readdirSync(claimDir).filter(f => f.endsWith(".md"));
      } catch {
        continue;
      }

      for (const file of files) {
        const path = join(claimDir, file);
        let fm: Record<string, unknown>;
        try {
          const raw = readFileSync(path, "utf8");
          fm = parseFrontmatter(raw).frontmatter;
        } catch {
          continue; // malformed → skip silently; other lint checks own that surface
        }

        const status = String(fm.status ?? "");
        if (status !== "active") continue;

        const confidence = typeof fm.confidence === "number" ? fm.confidence : Number(fm.confidence);
        const last_validated = String(fm.last_validated ?? "");
        if (!Number.isFinite(confidence) || !/^\d{4}-\d{2}-\d{2}$/.test(last_validated)) {
          continue; // schema-invalid; claim-frontmatter lint owns the signal
        }

        const eff = effectiveConfidence(
          { confidence, last_validated, status },
          today,
          { half_life_days: cfg.half_life_days, effective_floor: cfg.effective_floor },
        );

        if (eff < cfg.render_min_confidence) {
          const id = String(fm.id ?? file.replace(/\.md$/, ""));
          diagnostics.push({
            severity: "info",
            code: "CLAIM_EFFECTIVE_BELOW_FLOOR",
            page_id: id,
            wiki: wikiName,
            message:
              `claim "${id}" effective confidence ${eff.toFixed(3)} is below the render floor ` +
              `${cfg.render_min_confidence} (stored confidence ${confidence}, last_validated ${last_validated})`,
            suggestion:
              "revalidate (refresh last_validated + confidence) or retract — claims below render_min_confidence " +
              "are hidden from `claims.render` results and likely no longer reflect what the agent currently believes.",
          });
        }
      }
    }

    return diagnostics;
  },
});
