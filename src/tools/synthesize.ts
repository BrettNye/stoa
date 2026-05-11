// vault-mcp/src/tools/synthesize.ts
//
// Thin tool wrapper over `core/synthesize`. With `by_agent` set, runs an
// extra post-processing pass that injects (or removes) a marker-bounded
// `## Learnings` section into the just-written synthesis page, populated by
// clustering the profile's active claims by tag (per spec §8.5).
//
// The Learnings pass is purely additive — it operates on the serialized
// markdown after `synthesize()` has written it. This keeps `core/synthesize`
// untouched (sibling tasks edit it) and keeps the claims-system coupling
// confined to the tool boundary.
//
// Marker contract: `<!-- vault-claims-synthesis:start (rendered: <date>) -->`
// … `<!-- vault-claims-synthesis:end -->`. Re-renders are byte-identical
// modulo the `rendered:` date. When the profile has zero qualifying claims,
// the entire marker block is removed (cleanup behavior; spec §8.5).

import { z } from "zod";
import { promises as fsp, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { synthesize } from "../core/synthesize.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { loadActiveProfileClaims, clusterByTag } from "../core/claim-clustering.js";
import { renderBetweenMarkers, removeMarkerSection } from "../core/marker-render.js";
import { effectiveConfidence } from "../core/decay.js";
import { getClaimsConfig, type ClaimsConfig } from "../config.js";
import type { ParsedClaim } from "../core/claims.js";

const Input = z.object({
  topic: z.string().min(1),
  wiki: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  by_agent: z.string().optional(),
  scope: z.enum(["topic", "memory"]).default("topic"),
  prose: z.string().optional()
});

export interface SynthesizeCtx {
  vaultPath: string;
  defaultWiki?: string;
  rawConfig?: unknown;
}

export const synthesizeTool = {
  name: "vault.synthesize",
  description: "Compile or refresh a synthesis page from current matching pages. With by_agent + scope=memory, writes a per-agent memory synthesis at wikis/_agents/synthesis/synthesis-<by_agent>-memory.md, including a marker-bounded `## Learnings` section clustered by tag from the profile's active claims (spec §8.5).",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: SynthesizeCtx) => {
    const wiki = input.scope === "memory" ? "_agents" : resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);

    // Ensure the destination directory exists. `core/synthesize` writes via
    // `writeFileSync` without mkdir; for hermetic temp vaults that haven't
    // pre-created `wikis/_agents/synthesis/`, the write would ENOENT. The
    // directory is computed the same way `core/synthesize` does, so the
    // ensure-call is a no-op for established vaults.
    if (input.scope === "memory" && input.by_agent) {
      const synthDir = dirname(synthesisOutputPath(ctx.vaultPath, input.by_agent));
      mkdirSync(synthDir, { recursive: true });
    }

    const result = synthesize(ctx.vaultPath, { ...input, wiki });

    // Learnings injection — only on the by_agent path. The legacy by_agent
    // case without scope=memory (topic-scoped agent-author filter) does not
    // emit a Learnings section; only the per-agent memory page does, per
    // spec §8.5 ("when synthesizing per-agent memory").
    if (input.scope === "memory" && input.by_agent) {
      const claimsCfg = getClaimsConfig(ctx.rawConfig ?? {});
      const today = new Date();
      await injectLearningsSection(result.path, ctx.vaultPath, input.by_agent, today, claimsCfg);
    }

    return result;
  }
};

// Mirrors the path computation in `core/synthesize.ts` for the memory scope.
// Kept local so we don't have to import a non-exported helper from core.
function synthesisOutputPath(vaultPath: string, byAgent: string): string {
  return `${vaultPath}/wikis/_agents/synthesis/synthesis-${byAgent}-memory.md`;
}

/**
 * Read the just-written synthesis file, splice in (or remove) the
 * `vault-claims-synthesis` marker block, and write it back atomically.
 *
 * Placement: per spec §8.5 step 4, the Learnings block sits immediately
 * after the existing `## Inputs cited` section. We anchor on the next
 * heading boundary (the next `## ` line, or end-of-file) to avoid splitting
 * a hand-edited paragraph mid-flow.
 */
async function injectLearningsSection(
  filePath: string,
  vaultPath: string,
  profileId: string,
  today: Date,
  claimsCfg: ClaimsConfig,
): Promise<void> {
  const original = await fsp.readFile(filePath, "utf8");
  const claims = await loadActiveProfileClaims(vaultPath, profileId, today, claimsCfg);

  // Cleanup case: zero qualifying claims → remove any pre-existing marker block.
  if (claims.length === 0) {
    const stripped = removeMarkerSection(original, "vault-claims-synthesis");
    if (stripped !== original) {
      await fsp.writeFile(filePath, stripped, "utf8");
    }
    return;
  }

  const clusters = clusterByTag(claims, claimsCfg.specialty_min_cluster);
  if (clusters.size === 0) {
    // Claims exist but no cluster meets the minCluster floor → also remove.
    const stripped = removeMarkerSection(original, "vault-claims-synthesis");
    if (stripped !== original) {
      await fsp.writeFile(filePath, stripped, "utf8");
    }
    return;
  }

  const replacement = buildLearningsBody(clusters, today, claimsCfg);
  const renderedDate = today.toISOString().slice(0, 10);

  // Anchor: insert the marker block immediately after the `## Inputs cited`
  // section. If the markers already exist anywhere in the file,
  // `renderBetweenMarkers` will replace in place — no anchor needed.
  let nextContent: string;
  if (/<!--\s*vault-claims-synthesis:start/.test(original)) {
    nextContent = renderBetweenMarkers(
      original,
      "vault-claims-synthesis",
      replacement,
      { renderedDate },
    );
  } else {
    // First-time insertion: split at the end of the `## Inputs cited` block,
    // then render markers into the resulting hole. Falls back to append (the
    // default `renderBetweenMarkers` behavior on missing markers) if there's
    // no `## Inputs cited` heading at all.
    const inputsHeadingRe = /^## Inputs cited\b.*$/m;
    const inputsMatch = inputsHeadingRe.exec(original);
    if (inputsMatch) {
      const afterInputs = inputsMatch.index + inputsMatch[0].length;
      // Find the next `## ` heading after Inputs cited (or end of file).
      const tail = original.slice(afterInputs);
      const nextHeadingRe = /\n## /;
      const nextHeadingMatch = nextHeadingRe.exec(tail);
      const insertAt = nextHeadingMatch
        ? afterInputs + nextHeadingMatch.index
        : original.length;
      const before = original.slice(0, insertAt);
      const after = original.slice(insertAt);
      const seeded = `${before.replace(/\s+$/, "")}\n\n<!-- vault-claims-synthesis:start (rendered: ${renderedDate}) -->\n${replacement.trimEnd()}\n<!-- vault-claims-synthesis:end -->\n${after.startsWith("\n") ? after : (after.length > 0 ? "\n" + after : "")}`;
      nextContent = seeded;
    } else {
      nextContent = renderBetweenMarkers(
        original,
        "vault-claims-synthesis",
        replacement,
        { renderedDate },
      );
    }
  }

  if (nextContent !== original) {
    await fsp.writeFile(filePath, nextContent, "utf8");
  }
}

/**
 * Build the section body (the `## Learnings` heading + `### <tag> (n claims)`
 * subsections + bullets). Per spec §8.5, bullets render as:
 *   - **`<key>`** — <body>. *(confidence <effective>, validated <date>)*
 *
 * "<body>" is the claim's `summary` if present, falling back to its `title`
 * (the v1.5 friction T3-5 lesson: never assume a frontmatter field is set;
 * fall back gracefully).
 *
 * Cluster ordering: descending claim count, then alphabetical by tag for
 * determinism on ties.
 */
function buildLearningsBody(
  clusters: Map<string, ParsedClaim[]>,
  today: Date,
  claimsCfg: ClaimsConfig,
): string {
  const sortedTags = [...clusters.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const lines: string[] = ["## Learnings", ""];
  for (const [tag, arr] of sortedTags) {
    lines.push(`### ${tag} (${arr.length} claims)`);
    lines.push("");
    for (const c of arr) {
      const eff = effectiveConfidence(
        {
          confidence: c.confidence,
          last_validated: c.last_validated,
          status: c.status,
        },
        today,
        {
          half_life_days: claimsCfg.half_life_days,
          effective_floor: claimsCfg.effective_floor,
        },
      );
      const body = c.summary ?? c.title;
      lines.push(
        `- **\`${c.key}\`** — ${body}. *(confidence ${eff.toFixed(2)}, validated ${c.last_validated})*`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
