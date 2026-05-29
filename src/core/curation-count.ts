import { loadIndex } from "./index.js";
import { loadCandidates } from "./curation-candidates.js";
import { runRegisteredRules } from "./curation-rule.js";
import { gateActions } from "./curation-gate.js";
import { getCurationConfigForVault } from "../config.js";
import "./curation-rules/registration.js";

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
  const config = getCurationConfigForVault(vaultPath);
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
