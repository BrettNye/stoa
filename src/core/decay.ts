/**
 * effectiveConfidence — pure decay function for claim confidence.
 *
 * Spec: wikis/_meta/specs/2026-05-02-vault-mcp-claims-design.md §6.2
 *
 * Linear decay from `confidence` (at last_validated) toward zero, with a
 * configurable half-life (default 75 days) and a multiplicative floor
 * (default 0.1 of the stored confidence). Non-active claims (`superseded`,
 * `retracted`, `draft`, etc.) always return 0. Future `last_validated`
 * values are clamped to 0 elapsed days.
 *
 * `today` is injected by the caller; this module never reads `Date.now()`.
 */

export interface DecayInput {
  confidence: number;
  last_validated: string; // ISO date YYYY-MM-DD
  status: string;
}

export interface DecayConfig {
  half_life_days?: number;
  effective_floor?: number;
}

const DAY_MS = 86_400_000;

function calendarDays(fromIso: string, today: Date): number {
  const from = Date.UTC(
    +fromIso.slice(0, 4),
    +fromIso.slice(5, 7) - 1,
    +fromIso.slice(8, 10),
  );
  const to = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

export function effectiveConfidence(
  claim: DecayInput,
  today: Date,
  config: DecayConfig = {},
): number {
  if (claim.status !== "active") return 0;
  const halfLife = config.half_life_days ?? 75;
  const floor = config.effective_floor ?? 0.1;
  const rate = 0.5 / halfLife;
  const days = calendarDays(claim.last_validated, today);
  const factor = Math.max(floor, 1 - days * rate);
  return claim.confidence * factor;
}
