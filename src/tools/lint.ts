// vault-mcp/src/tools/lint.ts
import { z } from "zod";
import { lint } from "../core/lint.js";
import { loadIndex } from "../core/index.js";
import { runRegisteredChecks, type LintCheckCtx } from "../core/lint-check.js";

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

const Input = z.object({
  wiki: z.string().optional(),
  level: z.enum(["error", "warning", "info"]).default("warning")
});

export const lintTool = {
  name: "vault.lint",
  description: "Read-only health check across the vault. Surfaces issues and suggestions; never mutates.",
  inputSchema: Input,
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

    // Recompute summary so registry-emitted diagnostics are counted.
    result.summary = {
      errors: result.diagnostics.filter(d => d.severity === "error").length,
      warnings: result.diagnostics.filter(d => d.severity === "warning").length,
      info: result.diagnostics.filter(d => d.severity === "info").length,
    };
    return result;
  }
};
