// src/core/curate.ts
//
// Orchestrator for autonomous status curation (spec §4.4).
//
// Flow:
//   1. Load index + candidates
//   2. Run registered rules through the gate
//   3. Apply each `applies:true` action: readPage → writePage → upsertPage
//   4. Write one digest journal
//   5. Return { applied, flagged, journal_id }
//
// Idempotent: a page already at its target status emits no action (rules guard
// on current status from the index).
//
// dry_run: skips all writes; returns the would-apply set without journal_id.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadIndex, upsertPage } from "./index.js";
import { readPage, writePage } from "./pages.js";
import { loadCandidates } from "./curation-candidates.js";
import { runRegisteredRules } from "./curation-rule.js";
import { gateActions } from "./curation-gate.js";
import { writeCurationDigest } from "./curate-journal.js";
import { verifyPrMerged, type Runner } from "./curate-git.js";
import { getCurationConfig } from "../config.js";
import "./curation-rules/registration.js";
import type { CurationAction } from "./curation-rule.js";

export interface CurateInput {
  wiki?: string;
  dry_run?: boolean;
  confidence_floor?: "high" | "medium" | "low";
  httpMode?: boolean;
}

export interface CurateResult {
  applied: CurationAction[];
  flagged: CurationAction[];
  journal_id?: string;
}

/**
 * Load the raw `.stoa/config.json` as an unknown object for `getCurationConfig`.
 * Falls back to an empty object (all curation defaults) on missing file or
 * malformed JSON — mirrors `loadVaultStoaConfig`'s defensive pattern.
 */
function loadRawVaultConfig(vaultPath: string): unknown {
  const path = join(vaultPath, ".stoa", "config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export async function curate(
  vaultPath: string,
  agentId: string,
  input: CurateInput = {},
  run?: Runner,
): Promise<CurateResult> {
  // ── 1. Index + config ───────────────────────────────────────────────────────
  const idx = loadIndex(vaultPath);
  const rawConfig = loadRawVaultConfig(vaultPath);
  const base = getCurationConfig(rawConfig);
  const config = {
    ...base,
    confidence_floor: input.confidence_floor ?? base.confidence_floor,
  };

  // ── 2. Candidates + rules + gate ────────────────────────────────────────────
  const candidates = loadCandidates(vaultPath, idx, input.wiki);

  // httpMode or no runner → always "unknown" so PROMOTE_LANDED degrades to flag
  const prVerifier =
    input.httpMode || !run
      ? (): "unknown" => "unknown"
      : (ref: string) => verifyPrMerged(ref, run);

  const actions = runRegisteredRules({
    vaultPath,
    today: new Date(),
    config,
    candidates,
    verifyPrMerged: prVerifier,
  });

  const gated = gateActions(actions, config);
  const applied = gated.filter((a) => a.applies === true);
  const flagged = gated.filter((a) => a.applies !== true);

  // ── 3. dry_run: return without writing ─────────────────────────────────────
  if (input.dry_run) {
    return { applied, flagged };
  }

  // ── 4. Apply each action ────────────────────────────────────────────────────
  for (const action of applied) {
    // Read current page from disk
    const page = readPage(vaultPath, action.page_id, action.wiki);

    // Merge field_patch (e.g. archived_at, resolved_at, superseded_by) into
    // frontmatter, then set the target status. writePage auto-bumps `updated`.
    const fm: Record<string, unknown> = {
      ...page.frontmatter,
      ...(action.field_patch ?? {}),
      status: action.to_status,
    };

    const res = writePage(vaultPath, {
      id: action.page_id,
      type: page.frontmatter.type as import("./frontmatter.js").NoteType,
      wiki: action.wiki,
      frontmatter: fm,
      body: page.body,
      expectedUpdated: page.updated,
    });

    // Write-through index update (upsertPage is async)
    await upsertPage(vaultPath, res.path);
  }

  // ── 5. Digest journal ───────────────────────────────────────────────────────
  const targetWiki = input.wiki ?? "_meta";
  const journal_id = await writeCurationDigest(
    vaultPath,
    targetWiki,
    agentId,
    applied,
    flagged,
  );

  return { applied, flagged, journal_id };
}
