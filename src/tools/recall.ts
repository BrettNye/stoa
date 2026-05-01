// vault-mcp/src/tools/recall.ts
import { z } from "zod";
import { recall, type RecallHit } from "../core/recall.js";
import { loadIndex } from "../core/index.js";
import { resolveFamily, membersOf } from "../core/family.js";
import { findOnDisk } from "../core/disk-fallback.js";
import { toIsoDate } from "../core/frontmatter.js";

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
    const result = recall(ctx.vaultPath, { ...input, wikis });

    // v1.7 §5.4 — exact-id topic disk-fallback. When the index-based candidate
    // search returns zero hits AND `topic` matches an on-disk page id verbatim,
    // surface that page as a single fallback hit. Recovers pages authored on
    // disk but not yet seen by `vault.reindex`. Index-first semantics
    // preserved — the disk scan only fires on miss.
    if (result.hits.length === 0) {
      const onDisk = findOnDisk(ctx.vaultPath, input.topic);
      if (onDisk) {
        const inScope =
          (input.wiki && onDisk.wiki === input.wiki) ||
          (!input.wiki && wikis && wikis.includes(onDisk.wiki)) ||
          (!input.wiki && !wikis);
        if (inScope) {
          const fm = onDisk.frontmatter;
          const fallbackHit: RecallHit = {
            id: String(fm.id ?? input.topic),
            title: String(fm.title ?? fm.id ?? input.topic),
            type: String(fm.type ?? onDisk.type),
            wiki: onDisk.wiki,
            summary: String(fm.summary ?? ""),
            score: 1,
            status: String(fm.status ?? "draft"),
            updated: toIsoDate(fm.updated ?? fm.created ?? "")
          };
          if (fm.confidence) fallbackHit.confidence = String(fm.confidence);
          result.hits.push(fallbackHit);
          result.total_candidates += 1;
          if (["concept","spec","decision","synthesis","guide","source","idea","question"].includes(fallbackHit.type)) {
            result.segmented.knowledge += 1;
          } else if (["task","journal"].includes(fallbackHit.type)) {
            result.segmented.execution += 1;
          }
        }
      }
    }
    return result;
  }
};
