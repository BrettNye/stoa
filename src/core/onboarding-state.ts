import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type OnboardingState = {
  role: "engineering" | "sales" | "marketing" | "leadership" | "other";
  interaction_mode: "passive" | "active";
  work_surfaces: string[];
  team_or_solo: "team" | "solo";
  client: "claude-code" | "cursor" | "codex";
  vault_path: string;
  interview_completed_at: string;
};

function statePath(vaultPath: string): string {
  return join(vaultPath, "_index", "onboarding.json");
}

export function readOnboardingState(vaultPath: string): OnboardingState | null {
  const p = statePath(vaultPath);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as OnboardingState;
  } catch { return null; }
}

export function writeOnboardingState(vaultPath: string, state: OnboardingState): void {
  const p = statePath(vaultPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");
}
