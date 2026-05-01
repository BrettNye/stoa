// vault-mcp/src/tools/recall.ts
import { z } from "zod";
import { recall } from "../core/recall.js";
import { loadIndex } from "../core/index.js";
import { resolveFamily, membersOf } from "../core/family.js";

const Input = z.object({
  topic: z.string().min(1),
  wiki: z.string().optional(),
  // Phase-2 T3-2 — opt-in family-scope expansion. When set without `wiki:`,
  // recall scope expands to all members of the named family. Resolution chain
  // (per v1.6 spec §7.1): explicit `wiki:` always wins; if `wiki:` is unset
  // and `family:` is set (or `ctx.defaultFamily` / `.active-family` resolves a
  // family), the search runs across all members; both unset → existing v1.5
  // single-wiki behaviour. See `core/family.resolveFamily`.
  family: z.string().optional(),
  layer: z.enum(["knowledge", "execution", "all"]).default("knowledge"),
  include_archive: z.boolean().default(false),
  limit: z.number().int().positive().default(20),
  by_agent: z.string().optional()
});

export const recallTool = {
  name: "vault.recall",
  description: "Search the vault for prior thinking on a topic. Returns ranked hits with synthesis content inline.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultFamily?: string }
  ) => {
    // Family expansion happens in the tool layer (not core/recall). Reasoning:
    // resolveFamily reads `ctx.defaultFamily` + `.active-family`, which is a
    // dispatch-layer concern; `membersOf` needs the wiki map from the index.
    // Core stays pure — it just consumes the resolved `wikis: string[]` set.
    //
    // T3-6 will populate `ctx.defaultFamily` via `--default-family` and
    // `.active-family` plumbing. Until then `ctx.defaultFamily` is undefined,
    // and `resolveFamily` falls through to the `.active-family` file at
    // vault-root (already supported by `core/family.ts`) or returns null.
    let wikis: string[] | undefined;
    if (!input.wiki) {
      const idx = loadIndex(ctx.vaultPath);
      const knownWikis: Record<string, { family?: string | null }> = {};
      for (const w of idx.wikis) {
        knownWikis[w.name] = { family: w.family ?? null };
      }
      const resolvedFamily = resolveFamily(
        { vaultPath: ctx.vaultPath, defaultFamily: ctx.defaultFamily ?? undefined },
        input.family,
        input.wiki,
        knownWikis
      );
      if (resolvedFamily !== null) {
        wikis = membersOf(resolvedFamily, knownWikis);
      }
    }
    // When `wiki:` is explicitly set, ignore family entirely (most-specific
    // wins per spec §7.1). The `resolveFamily` sanity-check that would throw
    // on family/wiki mismatch is intentionally not invoked here — the wiki
    // filter is authoritative for recall's scope, and a mismatch case should
    // not block a perfectly valid single-wiki call.
    return recall(ctx.vaultPath, { ...input, wikis });
  }
};
