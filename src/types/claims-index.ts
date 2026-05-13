// vault-mcp/src/types/claims-index.ts
//
// Canonical type for the `_index/claims.json` sidecar. Single source of truth
// shared by the builder (`core/claims-index.ts`) and the reader
// (`tools/list-claims.ts`). Previously each module declared its own local
// interface; this module consolidates them.
//
// schema_version history:
//   1 — original shape (by_profile, by_move, by_scope_wiki, by_tag, global)
//   2 — adds by_authored_by bucket

export interface ClaimsIndex {
  by_profile: Record<string, string[]>;
  by_move: Record<string, string[]>;
  by_scope_wiki: Record<string, string[]>;
  by_tag: Record<string, string[]>;
  /** Inverted index by the claim's `authored_by` frontmatter field. Added in schema_version 2. */
  by_authored_by: Record<string, string[]>;
  global: string[];
  /** ISO timestamp of when the sidecar was assembled. */
  generated_at: string;
  /** Readers must tolerate both versions. Writers emit 2 from this task forward. */
  schema_version: 1 | 2;
}
