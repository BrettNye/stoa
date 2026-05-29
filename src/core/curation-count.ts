import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadIndex } from "./index.js";
import { loadCandidates } from "./curation-candidates.js";
import { runRegisteredRules } from "./curation-rule.js";
import { gateActions } from "./curation-gate.js";
import { getCurationConfig } from "../config.js";
import "./curation-rules/registration.js";

/**
 * Load the raw `.stoa/config.json` as an unknown object for `getCurationConfig`.
 * Falls back to `{}` (all curation defaults) on missing file or malformed JSON.
 * Mirrors the same private helper in curate.ts — a ~5-line duplicate acceptable
 * until a shared hoist into config.ts lands (noted follow-up).
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

/**
 * Count-only pass (spec §4.7): load candidates, run all registered curation
 * rules through the gate, and return the number of actions that would apply —
 * without writing anything to disk.
 *
 * Uses `verifyPrMerged: () => "unknown"` so this never shells out to git.
 * This keeps the count pass fast and safe for the hot session-start path
 * (the orient nudge).
 *
 * @param vaultPath  Absolute path to the vault root.
 * @param wiki       Optional wiki filter — when provided, only candidates whose
 *                   `wiki` field matches are considered.
 */
export function countCuratable(vaultPath: string, wiki?: string): number {
  const idx = loadIndex(vaultPath);
  const config = getCurationConfig(loadRawVaultConfig(vaultPath));
  const candidates = loadCandidates(vaultPath, idx, wiki);
  const actions = runRegisteredRules({
    vaultPath,
    today: new Date(),
    config,
    candidates,
    verifyPrMerged: () => "unknown",
  });
  return gateActions(actions, config).filter((a) => a.applies).length;
}
