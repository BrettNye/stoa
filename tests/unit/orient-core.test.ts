import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orient } from "../../src/core/orient-core.js";
import { writeOnboardingState } from "../../src/core/onboarding-state.js";
import type { OnboardingState } from "../../src/core/onboarding-state.js";

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), "orient-vault-"));
}

const SAMPLE_STATE: OnboardingState = {
  role: "engineering",
  interaction_mode: "active",
  work_surfaces: ["claude-code"],
  team_or_solo: "solo",
  client: "claude-code",
  vault_path: "/tmp/vault",
  interview_completed_at: "2026-05-20T00:00:00.000Z",
};

describe("orient — onboarding check", () => {
  it("suggests onboarding when state file is absent", () => {
    const v = tempVault();
    const r = orient({ vaultPath: v });
    expect(r.next_best_action).toContain("stoa onboard");
    expect(r.reasoning).toBeTruthy();
  });

  it("reasoning is non-empty when onboarding file is absent", () => {
    const v = tempVault();
    const r = orient({ vaultPath: v });
    expect(r.reasoning.length).toBeGreaterThan(0);
  });
});

describe("orient — inbox volume", () => {
  it("suggests /process-inbox when inbox has >=5 items across wikis", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    // Create 3 wikis with inbox items totalling 6
    for (const [wiki, count] of [["wiki-a", 3], ["wiki-b", 2], ["wiki-c", 1]] as [string, number][]) {
      const inboxDir = join(v, "wikis", wiki, "inbox");
      mkdirSync(inboxDir, { recursive: true });
      for (let i = 0; i < count; i++) {
        writeFileSync(join(inboxDir, `2026-05-20-${i.toString().padStart(4, "0")}-note.md`), "# note");
      }
    }
    const r = orient({ vaultPath: v });
    expect(r.next_best_action).toContain("/process-inbox");
    expect(r.reasoning).toMatch(/6/);
    expect(r.tool_to_call).toBe("vault_process-inbox");
    expect(r.suggestion_to_user).toContain("6");
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it("does NOT suggest /process-inbox when inbox has fewer than 5 items", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    const inboxDir = join(v, "wikis", "wiki-a", "inbox");
    mkdirSync(inboxDir, { recursive: true });
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(inboxDir, `2026-05-20-${i.toString().padStart(4, "0")}-note.md`), "# note");
    }
    const r = orient({ vaultPath: v });
    expect(r.next_best_action).not.toContain("/process-inbox");
  });
});

describe("orient — recall trigger", () => {
  it("returns vault_recall when message matches recall-shaped question", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    const r = orient({ vaultPath: v, recentUserMessage: "What did we figure out about the auth flow?" });
    expect(r.next_best_action).toContain("vault_recall");
    expect(r.tool_to_call).toBe("vault_recall");
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it("returns vault_recall for 'what do we know' variant", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    const r = orient({ vaultPath: v, recentUserMessage: "What do we know about the database design?" });
    expect(r.next_best_action).toContain("vault_recall");
    expect(r.tool_to_call).toBe("vault_recall");
  });

  it("does NOT trigger recall for unrelated messages", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    const r = orient({ vaultPath: v, recentUserMessage: "Can you help me write a function?" });
    expect(r.tool_to_call).not.toBe("vault_recall");
  });
});

describe("orient — steady state", () => {
  it("returns no-action when vault is in good shape", () => {
    const v = tempVault();
    writeOnboardingState(v, SAMPLE_STATE);
    const r = orient({ vaultPath: v });
    expect(r.next_best_action).toContain("No action");
    expect(r.reasoning.length).toBeGreaterThan(0);
  });

  it("reasoning is always populated regardless of branch", () => {
    const cases = [
      { vaultPath: tempVault() },
      (() => {
        const v = tempVault();
        writeOnboardingState(v, SAMPLE_STATE);
        return { vaultPath: v };
      })(),
      (() => {
        const v = tempVault();
        writeOnboardingState(v, SAMPLE_STATE);
        return { vaultPath: v, recentUserMessage: "What did we figure out?" };
      })(),
    ];
    for (const opts of cases) {
      const r = orient(opts);
      expect(r.reasoning.length).toBeGreaterThan(0);
    }
  });
});
