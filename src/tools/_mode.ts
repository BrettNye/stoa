// src/tools/_mode.ts
// Shared required-field guard for mode/surface-parametrized tools. `context`
// is the caller-supplied message prefix (e.g. "vault_wait-for mode=any"), so
// each tool keeps its exact error wording while reusing one implementation.
export function requireField<T>(value: T | null | undefined, context: string, field: string): T {
  if (value == null) throw new Error(`${context} requires '${field}'`);
  return value;
}
