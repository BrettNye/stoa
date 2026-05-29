import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readOnboardingState, type OnboardingState } from "./onboarding-state.js";
import { parseFrontmatter, toIsoDate } from "./frontmatter.js";
import { countCuratable } from "./curation-count.js";

export type OrientResult = {
  next_best_action: string;
  reasoning: string;
  tool_to_call?: string;
  suggestion_to_user?: string;
};

export function orient(opts: { vaultPath: string; recentUserMessage?: string }): OrientResult {
  const state = readOnboardingState(opts.vaultPath);
  if (!state) {
    return {
      next_best_action: "Run `stoa onboard` to set up the vault",
      reasoning: "No _index/onboarding.json present — onboarding hasn't completed on this machine.",
      suggestion_to_user: "Looks like Stoa isn't fully onboarded here. Want me to walk you through `stoa onboard`?",
    };
  }
  const inboxCount = countInbox(opts.vaultPath);
  if (inboxCount >= 5) {
    return {
      next_best_action: `Suggest /process-inbox`,
      reasoning: `Inbox has ${inboxCount} unprocessed items across wikis.`,
      tool_to_call: "vault_process-inbox",
      suggestion_to_user: `Your inbox has ${inboxCount} unprocessed items. Want me to walk through them?`,
    };
  }
  const staleCount = countStaleSyntheses(opts.vaultPath);
  if (staleCount >= 1) {
    return {
      next_best_action: `Suggest /synthesize for stale pages`,
      reasoning: `${staleCount} synthesis page${staleCount === 1 ? "" : "s"} have not been compiled in over 60 days.`,
      tool_to_call: "vault_synthesize",
      suggestion_to_user: `${staleCount} synthesis page${staleCount === 1 ? " is" : "s are"} stale (last compiled >60 days ago). Want me to recompile ${staleCount === 1 ? "it" : "them"}?`,
    };
  }
  const curatableCount = countCuratable(opts.vaultPath);
  if (curatableCount > 0) {
    return {
      next_best_action: `Suggest vault_curate`,
      reasoning: `${curatableCount} page${curatableCount === 1 ? "" : "s"} look${curatableCount === 1 ? "s" : ""} curatable.`,
      tool_to_call: "vault_curate",
      suggestion_to_user: `${curatableCount} page${curatableCount === 1 ? "" : "s"} look${curatableCount === 1 ? "s" : ""} curatable — run vault_curate to review.`,
    };
  }
  if (opts.recentUserMessage && /what (did|do) we (figure|know)/i.test(opts.recentUserMessage)) {
    return {
      next_best_action: "Run vault_recall before answering",
      reasoning: "User asked a recall-shaped question.",
      tool_to_call: "vault_recall",
    };
  }
  return {
    next_best_action: "No action — vault is in good shape",
    reasoning: "0 unprocessed inbox, no stale syntheses detected.",
  };
}

const STALE_SYNTHESIS_DAYS = 60;

function countStaleSyntheses(vaultPath: string): number {
  const todayMs = Date.now();
  const thresholdMs = STALE_SYNTHESIS_DAYS * 24 * 60 * 60 * 1000;
  let count = 0;
  try {
    const wikisDir = join(vaultPath, "wikis");
    for (const w of readdirSync(wikisDir)) {
      try {
        const synthesisDir = join(wikisDir, w, "synthesis");
        for (const f of readdirSync(synthesisDir).filter((n) => n.endsWith(".md"))) {
          try {
            const raw = readFileSync(join(synthesisDir, f), "utf8");
            const { frontmatter } = parseFrontmatter(raw);
            const lastCompiled = toIsoDate(frontmatter.last_compiled);
            if (!lastCompiled) continue;
            const compiledMs = new Date(lastCompiled).getTime();
            if (!isNaN(compiledMs) && todayMs - compiledMs > thresholdMs) {
              count++;
            }
          } catch { /* malformed file — treat as not stale */ }
        }
      } catch { /* no synthesis dir → skip */ }
    }
  } catch { return 0; }
  return count;
}

function countInbox(vaultPath: string): number {
  let count = 0;
  try {
    const wikisDir = join(vaultPath, "wikis");
    for (const w of readdirSync(wikisDir)) {
      try {
        const inbox = join(wikisDir, w, "inbox");
        count += readdirSync(inbox).filter((f) => f.endsWith(".md")).length;
      } catch { /* no inbox dir → skip */ }
    }
  } catch { return 0; }
  return count;
}
