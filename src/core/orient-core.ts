import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readOnboardingState, type OnboardingState } from "./onboarding-state.js";

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
