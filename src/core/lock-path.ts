/** True when `p` contains a glob metacharacter. Globs can never be lock keys. */
export function hasGlob(p: string): boolean {
  return /[*?[]/.test(p);
}

/**
 * Canonical form: no leading `./`, forward slashes only, no repeated slashes,
 * no trailing slash, not absolute. Idempotent — canonicalize(canonicalize(x)) === canonicalize(x).
 * Throws on a glob or an absolute path; those are refusals, not repairs.
 */
export function canonicalizeLockPath(p: string): string {
  if (hasGlob(p)) throw new Error(`lock path contains a glob: ${p}`);
  let out = p.replace(/\\/g, "/");
  // Collapse repeated slashes before stripping the leading "./" prefix, so a
  // spelling like ".//x" (dot + doubled slash) normalizes to "./x" first and
  // then loses its dot cleanly, rather than leaving a stray leading slash
  // that would be misread as an absolute path.
  out = out.replace(/\/{2,}/g, "/");
  out = out.replace(/^(\.\/)+/, "");
  if (/^\/|^[A-Za-z]:\//.test(out)) throw new Error(`lock path is absolute: ${p}`);
  out = out.replace(/\/+$/, "");
  if (out.length === 0) throw new Error(`lock path is empty after canonicalization: ${p}`);
  return out;
}

/** True when `p` is already exactly its canonical form. Used by the plugin-side converter contract. */
export function isCanonical(p: string): boolean {
  try {
    return canonicalizeLockPath(p) === p;
  } catch {
    return false;
  }
}
