// vault-mcp/src/tools/lint.ts
import { z } from "zod";
import { lint } from "../core/lint.js";
import { loadIndex } from "../core/index.js";
import { runRegisteredChecks, type LintCheckCtx } from "../core/lint-check.js";
import { findOnDisk } from "../core/disk-fallback.js";
import type { ToolScope } from "../auth/types.js";

// Side-effect-only imports: each module calls registerLintCheck() at load
// time. The IMPORTS THEMSELVES ARE THE WIRING — they look unused, but they
// populate the lintCheckRegistry that runRegisteredChecks below consumes.
// Wave 3 (Tasks 3-4a..e) replaces each stub's run-body without touching
// this file.
import "../core/lint-checks/cross-wiki-link-broken.js";
import "../core/lint-checks/threshold-block-invalid.js";
import "../core/lint-checks/active-wiki-divergence.js";
import "../core/lint-checks/deployment-drift.js";
import "../core/lint-checks/agent-attribution-aware.js";
import "../core/lint-checks/family-member-mode-drift.js";
import "../core/lint-checks/display-config-block-invalid.js";
import "../core/lint-checks/subagent-def-invariant-violation.js";
// Plan 1 (claims) — `registration.ts` is a barrel that side-effect-imports
// the three Group A claim rules (claim-key-collision, claim-effective-below-
// floor, claim-tag-repo-prefix-malformed) and adapter-registers the three
// Group B rules (claim-without-evidence, claim-with-no-scope, claim-
// superseded-without-supersedor). One import = all six claim rules wired.
import "../core/lint-checks/registration.js";
// 2026-05-08 substrate-adoption W1.2 — surfaces per-wiki tag clusters of
// hard-knowledge pages with no covering synthesis.
import "../core/lint-checks/synthesis-debt.js";
// 2026-05-08 substrate-adoption W1.3 — surfaces aging agent-authored drafts
// with no curation_priority annotation.
import "../core/lint-checks/missing-curation-priority.js";

const Input = z.object({
  wiki: z.string().optional(),
  level: z.enum(["error", "warning", "info"]).default("warning"),
  scope: z.enum(["full", "per-wiki"]).default("per-wiki")
});

const lintScope: ToolScope = {
  axis: (input: any) => (input as any).wiki ? `wikis/${(input as any).wiki}` : "*",
  adminOnly: (i: any) => (i as any).scope === "full",
};

// v1.7 §5.4 — extract the unknown-id from a CROSS_WIKI_LINK_BROKEN diagnostic
// message so the post-processing pass can verify the target on disk. Mirrors
// the format emitted by `core/lint-checks/cross-wiki-link-broken.ts`:
//   `... — unknown id "<id>"` (and possibly `unknown wiki "<name>", unknown id "<id>"`).
const UNKNOWN_ID_RE = /unknown id "([^"]+)"/;

export const lintTool = {
  name: "vault_lint",
  description: "Read-only health check across the vault. Surfaces issues and suggestions; never mutates.",
  inputSchema: Input,
  scope: lintScope,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string; defaultFamily?: string; fetcher?: typeof fetch }
  ) => {
    // Phase 1: existing inline checks live in core/lint.ts.
    const result = lint(ctx.vaultPath, input);

    // Phase 2: append diagnostics from registered (registry-based) checks.
    // Reload the index here — Wave 3 checks need the same view core/lint.ts
    // already saw. Stubs return [], so behaviour is unchanged for now.
    const idx = loadIndex(ctx.vaultPath);
    const lintCheckCtx: LintCheckCtx = {
      vaultPath: ctx.vaultPath,
      defaultWiki: ctx.defaultWiki,
      defaultFamily: ctx.defaultFamily,
      fetcher: ctx.fetcher,
    };
    result.diagnostics.push(...runRegisteredChecks(lintCheckCtx, idx, input));

    // v1.7 §5.4 — disk-fallback for CROSS_WIKI_LINK_BROKEN. The check uses
    // `idx.pages` to validate target ids; pages on disk but not yet indexed
    // would be falsely flagged. Suppress diagnostics whose unknown-id refers
    // to a page that exists on disk. Index-first preserved — `findOnDisk` is
    // only invoked on the diagnostic emission, never on every link.
    result.diagnostics = result.diagnostics.filter(d => {
      if (d.code !== "CROSS_WIKI_LINK_BROKEN") return true;
      const m = UNKNOWN_ID_RE.exec(d.message);
      if (!m) return true;  // wiki-unknown-only diagnostic — keep
      const targetId = m[1];
      const onDisk = findOnDisk(ctx.vaultPath, targetId);
      // Drop the diagnostic when the target id is recoverable from disk.
      return onDisk === null;
    });

    // Recompute summary so registry-emitted diagnostics are counted.
    result.summary = {
      errors: result.diagnostics.filter(d => d.severity === "error").length,
      warnings: result.diagnostics.filter(d => d.severity === "warning").length,
      info: result.diagnostics.filter(d => d.severity === "info").length,
    };
    return result;
  }
};
