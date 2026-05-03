import { createHash } from "node:crypto";

/**
 * Stable scope hash. Pure function over four named string-set dimensions.
 *
 * Properties:
 * - Order-independent within each dimension (arrays are sorted).
 * - Membership-sensitive (different sets hash differently).
 * - Dimension-collision-resistant (same value in different dimensions hashes
 *   differently — each dimension is labelled before joining).
 * - Deterministic across runs (sha256 of a canonical UTF-8 string).
 * - Fixed-length lowercase hex output (16 hex chars = 64 bits).
 */
export function scopeHash(
  profile: string[],
  move: string[],
  scope_wiki: string[],
  tags: string[],
): string {
  const dim = (label: string, values: string[]) =>
    `${label}:${[...values].sort().join(",")}`;
  const canonical = [
    dim("p", profile),
    dim("m", move),
    dim("w", scope_wiki),
    dim("t", tags),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
