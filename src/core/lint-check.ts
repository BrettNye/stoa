import type { Diagnostic, LintInput } from "./lint.js";
import type { VaultIndex } from "./index.js";

/**
 * Context object plumbed to every registered lint check. Use a context shape
 * (rather than positional args) so future checks — e.g. PokeAPI-aware checks
 * needing `fetcher`, or wiki-scoped checks needing `defaultWiki` — can grow
 * without back-patching every existing check.
 */
export interface LintCheckCtx {
  vaultPath: string;
  defaultWiki?: string;
  fetcher?: typeof fetch;
}

/**
 * A single lint check. The `code` is the diagnostic code prefix (informational;
 * checks may emit multiple codes if needed). `run` is pure: read the index +
 * input, return diagnostics. No I/O outside what's reachable from `ctx`.
 */
export interface LintCheck {
  code: string;
  run(ctx: LintCheckCtx, idx: VaultIndex, input: LintInput): Diagnostic[];
}

/**
 * Module-level registry. Checks register themselves at import time via
 * `registerLintCheck`. The runner (`core/lint.ts`) side-effect-imports the
 * stub barrel to populate this before invoking `runRegisteredChecks`.
 */
export const lintCheckRegistry: LintCheck[] = [];

export function registerLintCheck(check: LintCheck): void {
  lintCheckRegistry.push(check);
}

export function runRegisteredChecks(
  ctx: LintCheckCtx,
  idx: VaultIndex,
  input: LintInput
): Diagnostic[] {
  return lintCheckRegistry.flatMap(c => c.run(ctx, idx, input));
}
